import nodemailer from 'nodemailer';
import axios from 'axios';
import express, {Request, Response} from 'express';
import cors from 'cors';
import {Pool} from 'pg';
import {CronJob} from 'cron';
import {Gender, isQueryError} from './shared';
import type {Attendee, EventbriteEventsResponse, QueryError} from './shared';

const app = express();
const Port = process.env.PORT ?? 3000;
const EventbriteToken = process.env.EVENTBRITE_TOKEN;
const EventbriteOrg = process.env.EVENTBRITE_ORG;
const DatabaseURL = process.env.DATABASE_URL;
const EmailPassword = process.env.EMAIL_PASSWORD;
const AdminFirstName = process.env.ADMIN_FIRST_NAME;
const AdminLastName = process.env.ADMIN_LAST_NAME;
const AdminEmail = process.env.ADMIN_EMAIL;
const AdminPassword = process.env.ADMIN_PASSWORD;
const MatchesEmail = 'matches@sipsandsparks.org';
const ContactEmail = 'contact@sipsandsparks.org';

interface Event {
    id: string;
    name: string;
    start: string;
}

interface PublicAttendee {
    name: string;
    id: number;
}

enum EventbriteTicketClass {
    MaleTicket = 'Male Ticket',
    FemaleTicket = 'Female Ticket'
}

interface EventbriteAttendeesResponse {
    pagination: {
        has_more_items: boolean;
    };
    attendees: {
        profile: {
            first_name: string;
            last_name: string;
            email: string;
        };
        status: string;
        ticket_class_name: EventbriteTicketClass;
    }[];
}

const EventbriteTicketClassToGender: Record<EventbriteTicketClass, Gender> = {
    [EventbriteTicketClass.MaleTicket]: Gender.MALE,
    [EventbriteTicketClass.FemaleTicket]: Gender.FEMALE
}

const GenderToOppositeGender: Record<Gender, Gender> = {
    [Gender.MALE]: Gender.FEMALE,
    [Gender.FEMALE] : Gender.MALE
}

interface PostAdminLoginRequest {
    username: string;
    password: string;
}

interface PostAdminEventParticipantsRequest {
    username: string;
    password: string;
    eventId: string;
}

interface PostEventParticipantsRequest {
    eventId: string;
    firstName: string;
    lastName: string;
    email: string;
}

interface PostMatchRequest {
    eventId: string;
    firstName: string;
    lastName: string;
    email: string;
    matches: string[];
    notes: string;
    feedback: string;
    referralInfo: string;
    cellPhone: string;
    websiteFeedback?: string;
    sendContactToNonMutual: boolean;
}

const MatchesTransporter = nodemailer.createTransport({
    host: 'smtp.zoho.com',
    port: 465,
    secure: true,
    auth: {
        user: MatchesEmail,
        pass: EmailPassword
    }
});

const ContactTransporter = nodemailer.createTransport({
    host: 'smtp.zoho.com',
    port: 465,
    secure: true,
    auth: {
        user: 'contact@sipsandsparks.org',
        pass: EmailPassword
    }
});

const pool = new Pool({
    connectionString: DatabaseURL,
    ssl: {
      rejectUnauthorized: false
    }
});

function normalizeString(str: string) {
    return str.toLowerCase().trim();
}

function capitalizeName(name: string) {
    if (name.length === 0) {
        return name;
    }

    const trimmedName = name.trim();

    return trimmedName.charAt(0).toUpperCase() + trimmedName.slice(1);
}

async function sendConfirmationEmail(attendee: Attendee, notes: string, interestPeople: Attendee[]) {
    try {
        let confirmationText = `Dear ${attendee.firstName},\n\nThank you for attending our event. We have received your submission. Below is a copy of the information you provided:`;
        if (interestPeople.length > 0) {
            confirmationText += `\n\nWho would you like to see again after today?:`;
            interestPeople.forEach(person => {
                confirmationText += `\n- ${person.id} ${person.firstName}`;
            });
        }
        if (notes.replace(/\s+/g, '') !== '') {
            confirmationText += `\n\nNotes:\n${notes}`;
        }
        confirmationText += `\n\nThank you once again for participating. You can expect your match results via email within 24 hours.\n\nWith Love,\nSips and Sparks`

        const mailOptions = {
            from: MatchesEmail,
            to: attendee.email,
            subject: `Confirmation of Your Match Form Submission`,
            text: confirmationText
        };

        MatchesTransporter.sendMail(mailOptions, (error, _info) => {
            if (error) {
                console.error('Error sending confirmation email.', error.message);
                return ({message: 'Error sending confirmation email.'});
            }
        });
    } catch (e) {
        if (e instanceof Error) {
            console.error('Error sending confirmation email.', e.message);
        } else {
            console.error('Error sending confirmation email.');
        }
        return {message: 'Error sending confirmation email.'} as QueryError;
    }
}

async function sendReminderEmail(firstName: string, email: string) {
    try {
        let matchText = `Dear ${firstName},<br /><br />Thank you for attending our event! We noticed that we haven't received your match form submission yet. If this was an oversight, please finalize your choices and submit your match form <a href='https://sipsandsparks.org/match'>here</a>.<br /><br />`;
        matchText += `If you did not feel you found a meaningful connection this time around, don't worry, we'll be hosting many more speed dating events in the future with tons of different people and possibilities!<br /><br />`;
        matchText += `Follow us on <a href='https://www.facebook.com/sipsandsparks'>Facebook</a>, <a href='https://instagram.com/sipsandsparks'>Instagram</a>, and <a href='https://www.eventbrite.com/o/sips-and-sparks-73343957833'>Eventbrite</a> to stay up to date on all future speed dating events and receive exclusive promo codes!<br /><br />`
        matchText += `With Love,<br />Sips and Sparks Team`
    
        // Define email options
        let mailOptions = {
            from: 'matches@sipsandsparks.org',
            to: email,
            subject: `Last Chance to Submit Your Match Form`,
            html: matchText
        };

        MatchesTransporter.sendMail(mailOptions, (error, _info) => {
            if (error) {
                console.error('Error sending reminder email.', error.message);
            }
        });
    } catch (e) {
        if (e instanceof Error) {
            console.error('Error sending reminder email.', e.message);
        } else {
            console.error('Error sending reminder email.');
        }
    }
};

async function sendReminderEmails(eventId: string) {
    const attendees = await getAttendeesFromDatabaseToRemind(eventId);
    if (isQueryError(attendees) || attendees.length === 0) {
        return;
    }
    
    for (const att of attendees) {
        void sendReminderEmail(att.firstName, att.email);
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

async function getAttendeesFromDatabaseToRemind(eventId: string) {
    const client = await pool.connect();
    try {
        const result = await client.query(`
            SELECT first_name, email
            FROM event_attendees
            WHERE event_id = $1 AND in_attendance = true AND interests IS NULL
        `, [eventId]);
  
        return result.rows.map((att) => ({
            firstName: att.first_name,
            email: att.email
        }));
    } catch (e) {
        if (e instanceof Error) {
            console.error('Error fetching participants from database.', e.message);
        } else {
            console.error('Error fetching participants from database.');
        }
        return {message: 'Error fetching participants from database.'} as QueryError;
    } finally {
        client.release();
    }
}

async function getAttendeesFromDatabase(eventId: string) {
    const client = await pool.connect();
    try {
        const result = await client.query(`
            SELECT *
            FROM event_attendees
            WHERE event_id = $1
        `, [eventId]);
  
        const attendees: Attendee[] = result.rows.map((att) => ({
            firstName: att.first_name,
            lastName: att.last_name,
            email: att.email,
            id: att.attendee_id,
            gender: att.gender,
            inAttendance: att.in_attendance ?? undefined,
            notes: att.notes ?? undefined,
            cellPhone: att.cell_phone ?? undefined,
            feedback: att.feedback ?? undefined,
            referralInfo: att.referral_info ?? undefined,
            interests: (att.interests && att.interests !== '--') ? att.interests.split(',').map(Number) : [],
            websiteFeedback: att.website_feedback ?? undefined,
            sendContactToNonMutual: att.send_contact_to_non_mutual ?? false
        }));

        return attendees.sort((a, b) => a.id - b.id);
    } catch (e) {
        if (e instanceof Error) {
            console.error('Error fetching participants from database.', e.message);
        } else {
            console.error('Error fetching participants from database.');
        }
        return {message: 'Error fetching participants from database.'} as QueryError;
    } finally {
        client.release();
    }
}

async function addAttendeesToDatabase(eventId: string, attendees: Attendee[]) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN'); // Start a transaction
  
        const queries = attendees.map((att) => {
            return client.query(`
                INSERT INTO event_attendees (event_id, first_name, last_name, email, gender, attendee_id)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (event_id, email) 
                DO UPDATE SET 
                    first_name = EXCLUDED.first_name, 
                    last_name = EXCLUDED.last_name, 
                    gender = EXCLUDED.gender, 
                    attendee_id = EXCLUDED.attendee_id;
            `, [eventId, att.firstName, att.lastName, att.email, att.gender, att.id]);
        });
  
        await Promise.all(queries);
        await client.query('COMMIT');

        return;
    } catch (e) {
        if (e instanceof Error) {
            console.error('Error adding participants to database.', e.message);
        } else {
            console.error('Error adding participants to database.');
        }
        return {message: 'Error adding participants to database.'} as QueryError;
    } finally {
        client.release();
    }
}

async function updateAttendeeAttendance(eventId: string, email: string) {
    const client = await pool.connect();
    try {
        await client.query(`
            UPDATE event_attendees
            SET in_attendance = true
            WHERE event_id = $1 and email = $2
        `, [eventId, email]);

        return;
    } catch (e) {
        if (e instanceof Error) {
            console.error('Error updating attendance in database.', e.message);
        } else {
            console.error('Error updating attendance in database.');
        }
        return {message: 'Error updating attendance in database.'} as QueryError;
    } finally {
      client.release();
    }
}

async function addMatchFormSubmissionToDatabase(eventId: string, email: string, interests: string, feedback: string, referralInfo: string, cellPhone: string, notes: string, websiteFeedback: string, sendContactToNonMutual: boolean) {
    const client = await pool.connect();
    try {
        await client.query(`
            UPDATE event_attendees
            SET interests = $1,
                feedback = $2,
                referral_info = $3,
                cell_phone = $4,
                notes = $5,
                website_feedback = $6,
                send_contact_to_non_mutual = $7
            WHERE event_id = $8 AND email = $9
        `, [interests, feedback, referralInfo, cellPhone, notes, websiteFeedback, sendContactToNonMutual, eventId, email]);

      return;
    } catch (e) {
        if (e instanceof Error) {
            console.error('Error adding match form submission to database.', e.message);
        } else {
            console.error('Error adding match form submission to database.');
        }
        return {message: 'Error adding match form submission to database.'} as QueryError;
    } finally {
        client.release();
    }
}

function removeDuplicateEmailsFromAttendees(attendees: Attendee[]) {
    const seenEmails = new Set<string>();
    return attendees.filter(att => {
        if (seenEmails.has(att.email)) {
            return false;
        } else {
            seenEmails.add(att.email);
            return true;
        }
    });
}

async function getEventsFromEventbrite(getAll = false) {
    let allEvents: Event[] = [];
    let currentPage = 1;
    let checkNextPage = true;
    try {
        while (checkNextPage) {
            const response = await axios.get(`https://www.eventbriteapi.com/v3/organizations/${EventbriteOrg}/events/?page=${currentPage}`, { 
                headers: { 
                    Authorization: `Bearer ${EventbriteToken}` 
                }
            });

            const data = response.data as EventbriteEventsResponse;

            if (!data.pagination.has_more_items) {
                checkNextPage = false;
            } else {
                currentPage += 1;
            }

            // Current UTC date
            const currentDate = new Date();

            const events: Event[] = data.events.filter((event) => {
                if (getAll) {
                    return true;
                }

                const eventStartDate = new Date((new Date(event.start.utc)).getTime() - (8 * 60 * 60 * 1000));
                // Check if the event has already started
                if (currentDate >= eventStartDate) {
                    // Check if we are still earlier than the day after the event at 9am (when matches are sent)
                    const eventFormDeadline = new Date(event.start.utc);
                    eventFormDeadline.setUTCDate(eventFormDeadline.getUTCDate() + 1);
                    eventFormDeadline.setUTCHours(12, 55, 0, 0);
                    return currentDate < eventFormDeadline;
                }
                return false; // Event hasn't started yet
            }).map((event) => ({id: event.id, name: event.name.text, start: event.start.local}));

            allEvents = [...allEvents, ...events];
        }

        return allEvents;
    } catch (e) {
        if (e instanceof Error) {
            console.error('Error fetching events from Eventbrite.', e.message);
        } else {
            console.error('Error fetching events from Eventbrite.');
        }
        return {message: 'Error fetching events from Eventbrite.'} as QueryError;
    }
};

async function getAttendeesFromEventbrite(eventId: string) {
    let allAttendees: Attendee[] = [];
    let currentPage = 1;
    let checkNextPage = true;
    try {
        while (checkNextPage) {
            const response = await axios.get(`https://www.eventbriteapi.com/v3/events/${eventId}/attendees/?page=${currentPage}`, { 
                headers: { 
                    Authorization: `Bearer ${EventbriteToken}` 
                }
            });

            const data = response.data as EventbriteAttendeesResponse;

            if (!data.pagination.has_more_items) {
                checkNextPage = false;
            } else {
                currentPage += 1;
            }

            const attendees: Attendee[] = data.attendees.filter((att) => att.status === 'Attending').map((att) => ({
                firstName: capitalizeName(att.profile.first_name),
                lastName: capitalizeName(att.profile.last_name),
                email: normalizeString(att.profile.email),
                gender: EventbriteTicketClassToGender[att.ticket_class_name],
                id: 0
            }));

            allAttendees = [...allAttendees, ...attendees];
        }

        const filteredAttendees = removeDuplicateEmailsFromAttendees(allAttendees);
        return filteredAttendees;
    } catch (e) {
        if (e instanceof Error) {
            console.error('Error fetching participants from Eventbrite.', e.message);
        } else {
            console.error('Error fetching participants from Eventbrite.');
        }
        return {message: 'Error fetching participants from Eventbrite.'} as QueryError;
    }
}

function isAdminInfo(firstName: string, lastName: string, email: string) {
    return (firstName === AdminFirstName && lastName === AdminLastName && email === AdminEmail);
}

function isAttendeePresent(firstName: string, lastName: string, email: string, attendees: Attendee[]) {
    return attendees.some((att) => att.email === email && normalizeString(att.firstName) === normalizeString(firstName) && normalizeString(att.lastName) === normalizeString(lastName));
}

function sortAttendees(attendees: Attendee[]) {
    return attendees.sort((a, b) => {
        const firstNameA = a.firstName;
        const firstNameB = b.firstName;
      
        if (firstNameA < firstNameB) {
          return -1;
        } else if (firstNameA > firstNameB) {
          return 1;
        }

        // First names are the same, go by last name
        const lastNameA = a.lastName;
        const lastNameB = b.lastName;

        if (lastNameA < lastNameB) {
            return -1;
        } else if (lastNameA > lastNameB) {
            return 1;
        }
        return 0;
    });
}

function assignIDToAttendees(attendees: Attendee[], startingIndex?: number) {
    const baseIndex = startingIndex ?? 0;
    return attendees.map((attendee, index) => ({...attendee, id: index + 1 + baseIndex} as Attendee));
}

function getOppositeGenderOfAttendee(email: string, attendees: Attendee[]) {
    const ourAttendee = attendees.find((att) => att.email === email);
    return GenderToOppositeGender[ourAttendee?.gender ?? Gender.FEMALE];
}

function getPublicAttendeeName(attendee: Attendee, attendees: Attendee[]) {
    const attendeesWithSameFirstName = attendees.filter((att) => attendee.firstName === att.firstName && attendee.lastName !== att.lastName);
    if (attendeesWithSameFirstName.length > 0) {
        if (attendeesWithSameFirstName.some((att) => att.lastName[0] === attendee.lastName[0])) {
            return `${attendee.firstName} ${attendee.lastName.slice(0, 2)}`;
        }
        return `${attendee.firstName} ${attendee.lastName.slice(0, 1)}`;
    }
    return attendee.firstName;
}

function makePublicAttendees(attendees: Attendee[], gender: Gender) {
    const filteredAttendees = attendees.filter((att) => att.gender !== gender);
    return filteredAttendees.map((att) => ({
        name: getPublicAttendeeName(att, filteredAttendees), 
        id: att.id
    } as PublicAttendee));
}

const setEventMatchFormData = async (eventId: string, firstName: string, lastName: string, email: string, matches: string[], notes: string, feedback: string, referralInfo: string, cellPhone: string, websiteFeedback: string | undefined, sendContactToNonMutual: boolean) => {
    // Make sure the matches are numbers
    if (matches.some((str) => isNaN(parseInt(str)) || parseInt(str) === 0) || matches.length > 50) {
        // Someone is trying to send malicious requests
        console.log("Invalid interest selections.");
        console.log(matches);
        return ({message: "Invalid interest selections."});
    }

    const eventsList = await getEventsFromEventbrite();
    if (isQueryError(eventsList)) {
        return eventsList;
    }

    if (!eventsList.some((e) => e.id === eventId)) {
        return ({message: "Submissions for this event are now closed."} as QueryError);
    }

    const attendees = await getAttendeesFromDatabase(eventId);
    if (isQueryError(attendees)) {
        return attendees;
    }

    const isValidAttendee = isAttendeePresent(firstName, lastName, email, attendees);
    const ourAttendee = attendees.find((att) => att.email === email);
    if (!isValidAttendee || !ourAttendee) {
        return ({message: "Participant not found in the database."} as QueryError);
    }
        
    const interests = matches.length > 0 ? matches.sort().join(',') : '--';
    const queryResult = await addMatchFormSubmissionToDatabase(eventId, email, interests, feedback, referralInfo, cellPhone, notes, websiteFeedback ?? '', sendContactToNonMutual);
    if (isQueryError(queryResult)) {
        return queryResult;
    }

    const oppositeGenderAttendees = attendees.filter((att) => att.gender !== ourAttendee.gender);
    const interestPeople = oppositeGenderAttendees.filter((att) => matches.includes(String(att.id))).map((att) => ({...att, firstName: getPublicAttendeeName(att, oppositeGenderAttendees)}));
    await sendConfirmationEmail(ourAttendee, notes, interestPeople);
};

async function scheduleReminderEmailsForToday() {
    let allEvents: {id: string; name: {text: string;}; start: {utc: string; local: string;}; end: {utc: string;};}[] = [];
    let currentPage = 1;
    let checkNextPage = true;
    try {
        const currentDate = new Date();
        while (checkNextPage) {
            const response = await axios.get(`https://www.eventbriteapi.com/v3/organizations/${EventbriteOrg}/events/?page=${currentPage}`, { 
                headers: { 
                    Authorization: `Bearer ${EventbriteToken}` 
                }
            });

            const data = response.data as EventbriteEventsResponse;

            if (!data.pagination.has_more_items) {
                checkNextPage = false;
            } else {
                currentPage += 1;
            }

            const events = data.events.filter((event) => {
                const eventEndDate = new Date(event.end.utc);
                const timeDifference = currentDate.getTime() - eventEndDate.getTime();
                const hoursDifference = timeDifference / (1000 * 60 * 60);
                return hoursDifference > 0 && hoursDifference <= 24;
            });

            allEvents = [...allEvents, ...events];
        }

        allEvents.forEach(event => {
            const eventEndDate = new Date(event.end.utc);
            const reminderTime = new Date(eventEndDate.getTime() + 60 * 60 * 1000);
            const delay = reminderTime.getTime() - currentDate.getTime();
            if (delay > 0) {
                setTimeout(async () => {
                    console.log(`Sending reminders for event id: ${event.id}`);
                    await sendReminderEmails(event.id);
                }, delay);
            } else {
                console.log(`The event id ${event.id} has already passed the 1-hour mark. Reminders will not be sent.`);
            }
        });
    } catch (e) {
        if (e instanceof Error) {
            console.error('Error scheduling reminder emails.', e.message);
        } else {
            console.error('Error scheduling reminder emails.');
        }
    }
}

const reminderJob = new CronJob('0 0 * * *', async () => {
    console.log('Scheduling Cron job for reminder emails.');
    void scheduleReminderEmailsForToday();
});

reminderJob.start();

// REST Requests
app.use(express.json());
app.use(cors({
    origin: 'https://sipsandsparks.org'
}));

app.post('/contact', (req, res: Response) => {
    try {
        const {message, email, name} = req.body;

        let mailOptions = {
            from: ContactEmail,
            to: ContactEmail,
            subject: `Contact Query - ${name}`,
            text: `Message from: ${name}\nEmail: ${normalizeString(email)}\n\n${message}`
        };

        ContactTransporter.sendMail(mailOptions, (error, _info) => {
            if (error) {
                console.error('Error submitting contact query.', error.message);
                res.json({error: 'Error submitting contact query.'});
                return;
            }
        });

        res.status(200).json();
    } catch (e) {
        if (e instanceof Error) {
            console.error('Unknown error in contact endpoint.', e.message);
        } else {
            console.error('Unknown error in contact endpoint.');
        }
        res.json({error: 'Error submitting contact query.'});
    }
});

app.get('/events', async (_req, res: Response) => {
    try {
        const events = await getEventsFromEventbrite();
        if (isQueryError(events)) {
            res.json({error: events.message});
            return;
        }
        res.json({events: events});
    } catch (e) {
        if (e instanceof Error) {
            console.error('Unknown error in events endpoint.', e.message);
        } else {
            console.error('Unknown error in events endpoint.');
        }
        res.json({error: 'Error getting events.'});
    }
});

app.post('/admin/login', async (req: Request<{}, {}, PostAdminLoginRequest>, res: Response) => {
    try {
        const {username, password} = req.body;
        const normalizedUsername = normalizeString(username);
        if (normalizedUsername === AdminEmail && password === AdminPassword) {
            const events = await getEventsFromEventbrite(true);
            if (isQueryError(events)) {
                res.json({error: events.message});
                return;
            }
            res.json({events: events.slice(40, 45)});
        } else {
            res.json({error: 'Incorrect username or password.'});
        }
    } catch (e) {
        if (e instanceof Error) {
            console.error('Unknown error in admin login endpoint.', e.message);
        } else {
            console.error('Unknown error in admin login endpoint.');
        }
        res.json({error: 'Internal Error encountered while trying to login.'});
    }
});

app.post('/admin/event-participants', async (req: Request<{}, {}, PostAdminEventParticipantsRequest>, res: Response) => {
    try {
        const {eventId, username, password} = req.body;
        const normalizedUsername = normalizeString(username);

        if (!(normalizedUsername === AdminEmail && password === AdminPassword)) {
            res.json({error: 'Incorrect username or password.'});
            return;
        }

        const eventbriteAttendees = await getAttendeesFromEventbrite(eventId);
        if (isQueryError(eventbriteAttendees)) {
            res.json({error: eventbriteAttendees.message});
            return;
        }

        const databaseAttendees = await getAttendeesFromDatabase(eventId);
        if (isQueryError(databaseAttendees)) {
            res.json({error: databaseAttendees.message});
            return;
        }

        let allAttendees: Attendee[] = [];
        if (databaseAttendees.length === 0) {
            // This is the first request for this event. We must initialize the database.
            const sortedAttendees = sortAttendees(eventbriteAttendees);
            const maleAttendees = assignIDToAttendees(sortedAttendees.filter((att) => att.gender === Gender.MALE));
            const femaleAttendees = assignIDToAttendees(sortedAttendees.filter((att) => att.gender === Gender.FEMALE));
            allAttendees = [...maleAttendees, ...femaleAttendees];
            
            // Initialize the database
            const queryResult = await addAttendeesToDatabase(eventId, allAttendees);
            if (isQueryError(queryResult)) {
                res.json({error: queryResult.message});
                return;
            }
        } else {
            // We already have data in the database. Check if anyone new has been added to Eventbrite.
            const attendeesNotInDatabase = eventbriteAttendees.filter((ebAtt) => !databaseAttendees.some((dbAtt) => dbAtt.email === ebAtt.email));
            if (attendeesNotInDatabase.length > 0) {
                // There is someone in the Eventbrite list who is not yet in our database.
                const sortedNewAttendees = sortAttendees(attendeesNotInDatabase);
                // Assign them IDs starting from the last index of the attendees who already have IDs
                const newMaleAttendees = assignIDToAttendees(sortedNewAttendees.filter((att) => att.gender === Gender.MALE), databaseAttendees.filter((att) => att.gender === Gender.MALE).length);
                const newFemaleAttendees = assignIDToAttendees(sortedNewAttendees.filter((att) => att.gender === Gender.FEMALE), databaseAttendees.filter((att) => att.gender === Gender.FEMALE).length);
                const allNewAttendees = [...newMaleAttendees, ...newFemaleAttendees];
                allAttendees = [...databaseAttendees, ...allNewAttendees];

                // Add the new people to the database
                const queryResult = await addAttendeesToDatabase(eventId, allNewAttendees);
                if (isQueryError(queryResult)) {
                    res.json({error: queryResult.message});
                    return;
                }
            } else {
                allAttendees = databaseAttendees;
            }
        }

        const publicAttendees = makePublicAttendees(allAttendees, Gender.MALE);
        res.json({public_attendees: publicAttendees, admin_attendees: allAttendees});
    } catch (e) {
        if (e instanceof Error) {
            console.error('Unknown error in admin event-participants endpoint.', e.message);
        } else {
            console.error('Unknown error in admin event-participants endpoint.');
        }
        res.json({error: 'Error getting event participants.'});
    }
});

app.post('/event-participants', async (req: Request<{}, {}, PostEventParticipantsRequest>, res: Response) => {
    try {
        const {eventId, firstName, lastName, email} = req.body;
        const normalizedFirstName = capitalizeName(firstName);
        const normalizedLastName = capitalizeName(lastName);
        const normalizedEmail = normalizeString(email);

        const eventbriteAttendees = await getAttendeesFromEventbrite(eventId);
        if (isQueryError(eventbriteAttendees)) {
            res.json({error: eventbriteAttendees.message});
            return;
        }

        const isAdmin = isAdminInfo(normalizedFirstName, normalizedLastName, normalizedEmail);
        if (!isAdmin && !isAttendeePresent(normalizedFirstName, normalizedLastName, normalizedEmail, eventbriteAttendees)) {
            res.json({error: 'Participant is not present in Eventbrite.'});
            return;
        }

        const databaseAttendees = await getAttendeesFromDatabase(eventId);
        if (isQueryError(databaseAttendees)) {
            res.json({error: databaseAttendees.message});
            return;
        }

        let allAttendees: Attendee[] = [];
        if (databaseAttendees.length === 0) {
            // This is the first request for this event. We must initialize the database.
            const sortedAttendees = sortAttendees(eventbriteAttendees);
            const maleAttendees = assignIDToAttendees(sortedAttendees.filter((att) => att.gender === Gender.MALE));
            const femaleAttendees = assignIDToAttendees(sortedAttendees.filter((att) => att.gender === Gender.FEMALE));
            allAttendees = [...maleAttendees, ...femaleAttendees];
            
            // Initialize the database
            const queryResult = await addAttendeesToDatabase(eventId, allAttendees);
            if (isQueryError(queryResult)) {
                res.json({error: queryResult.message});
                return;
            }
        } else {
            // We already have data in the database. Check if anyone new has been added to Eventbrite.
            const attendeesNotInDatabase = eventbriteAttendees.filter((ebAtt) => !databaseAttendees.some((dbAtt) => dbAtt.email === ebAtt.email));
            if (attendeesNotInDatabase.length > 0) {
                // There is someone in the Eventbrite list who is not yet in our database.
                const sortedNewAttendees = sortAttendees(attendeesNotInDatabase);
                // Assign them IDs starting from the last index of the attendees who already have IDs
                const newMaleAttendees = assignIDToAttendees(sortedNewAttendees.filter((att) => att.gender === Gender.MALE), databaseAttendees.filter((att) => att.gender === Gender.MALE).length);
                const newFemaleAttendees = assignIDToAttendees(sortedNewAttendees.filter((att) => att.gender === Gender.FEMALE), databaseAttendees.filter((att) => att.gender === Gender.FEMALE).length);
                const allNewAttendees = [...newMaleAttendees, ...newFemaleAttendees];
                allAttendees = [...databaseAttendees, ...allNewAttendees];

                // Add the new people to the database
                const queryResult = await addAttendeesToDatabase(eventId, allNewAttendees);
                if (isQueryError(queryResult)) {
                    res.json({error: queryResult.message});
                    return;
                }
            } else {
                allAttendees = databaseAttendees;
            }
        }

        if (isAdmin) {
            res.json({attendees: allAttendees});
        } else {
            updateAttendeeAttendance(eventId, normalizedEmail);
            const ourAttendee = allAttendees.find((att) => att.email === normalizedEmail);
            const publicAttendees = makePublicAttendees(allAttendees, ourAttendee?.gender ?? Gender.FEMALE);
            if (ourAttendee && ourAttendee?.notes !== undefined) {
                const previousInfo = {notes: ourAttendee.notes, feedback: ourAttendee.feedback ?? '', cellPhone: ourAttendee.cellPhone ?? '', interests: ourAttendee.interests ?? [], referralInfo: ourAttendee.referralInfo ?? '', websiteFeedback: ourAttendee.websiteFeedback ?? '', sendContactToNonMutual: ourAttendee.sendContactToNonMutual ?? false};
                res.json({attendees: publicAttendees, previousInfo: previousInfo});
            } else {
                res.json({attendees: publicAttendees});
            }
        }
    } catch (e) {
        if (e instanceof Error) {
            console.error('Unknown error in event-participants endpoint.', e.message);
        } else {
            console.error('Unknown error in event-participants endpoint.');
        }
        res.json({error: 'Error getting event participants.'});
    }
});

app.post('/match', async (req: Request<{}, {}, PostMatchRequest>, res: Response) => {
    try {
        const {eventId, firstName, lastName, email, matches, notes, feedback, referralInfo, cellPhone, websiteFeedback, sendContactToNonMutual} = req.body;
        const normalizedFirstName = capitalizeName(firstName);
        const normalizedLastName = capitalizeName(lastName);
        const normalizedEmail = normalizeString(email);

        const queryResult = await setEventMatchFormData(eventId, normalizedFirstName, normalizedLastName, normalizedEmail, matches, notes, feedback, referralInfo, cellPhone, websiteFeedback, sendContactToNonMutual);
        if (isQueryError(queryResult)) {
            res.json({error: queryResult});
            return;
        }
        res.status(200).json();
    } catch (e) {
        if (e instanceof Error) {
            console.error('Unknown error in match endpoint.', e.message);
        } else {
            console.error('Unknown error in match endpoint.');
        }
        res.json({error: 'Error submitting match form.'});
    }
});

app.listen(Port, () => {
    console.log(`Server running on Port ${Port}`);
});