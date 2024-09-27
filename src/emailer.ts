import nodemailer from 'nodemailer';
import axios from 'axios';
import {Pool} from 'pg';
import {Gender, isQueryError} from './shared';
import type {Attendee, EventbriteEventsResponse, QueryError} from './shared';

const EventbriteToken = process.env.EVENTBRITE_TOKEN;
const EventbriteOrg = process.env.EVENTBRITE_ORG;
const DatabaseURL = process.env.DATABASE_URL;
const EmailPassword = process.env.EMAIL_PASSWORD;
const MatchesEmail = 'matches@sipsandsparks.org';
const ContactEmail = 'contact@sipsandsparks.org';

interface Event {
    id: string;
    date: string;
}

const alreadySentEmailsEventIds = new Set<string>();

// Constants
const MatchesAndRevisitsText =
`
<br />Keep in mind that the individuals that you did not select on your match sheet will not be receiving your contact information, so if you do decide to explore those connections further you will have to be the one to reach out to them.<br />
<br />Follow us on <a href='https://www.facebook.com/sipsandsparks'>Facebook</a>, <a href='https://instagram.com/sipsandsparks'>Instagram</a>, and <a href='https://www.eventbrite.com/o/sips-and-sparks-73343957833'>Eventbrite</a> to stay up to date on all future speed dating events and receive exclusive promo codes!<br />
`

const matchesText =
`
<br />We are a new organization so please help us spread the word by telling all of your single friends and family members about our events and leaving us a review on <a href='https://www.facebook.com/sipsandsparks'>Facebook</a>!<br />
<br />Reviews help people feel more comfortable about the speed dating process, thereby increasing the number of new participants at future events, and leading to more potential matches! We're also offering 20% off any future event as a thank you for taking the time to write us a review.<br />
<br />Best of luck exploring your new connections!<br />
<br />The Sips and Sparks Team<br /><br />
<br />P.S. We just launched our website and are hoping to feature a few success stories on there! So please email us your love story if you end up finding your person at one of our events! We can't wait to hear from you!
`;

const MatchesRevisitText =
`
<br />You also received interest from the following attendees who you may want to revisit a potential connection with:<br />
`;

const OnlyRevisitsText =
`Unfortunately you did not have any mutual matches this time around, but we'll be hosting more speed dating events in the future with tons of different people and possibilities!<br />
<br />However, you did receive interest from the following attendees who you may want to revisit a potential connection with:<br />
`;

const OnlyRevisitsEndText =
`
<br />Keep in mind that these individuals will not be receiving your contact information since you did not select them on your match sheet, so if you do decide to explore these connections further you will have to be the one to reach out to them.<br />
<br />Follow us on <a href='https://www.facebook.com/sipsandsparks'>Facebook</a>, <a href='https://instagram.com/sipsandsparks'>Instagram</a>, and <a href='https://www.eventbrite.com/o/sips-and-sparks-73343957833'>Eventbrite</a> to stay up to date on all future speed dating events and receive exclusive promo codes!<br />
<br />We are a new organization so please help us spread the word by telling all of your single friends and family members about our events and leaving us a review on <a href='https://www.facebook.com/sipsandsparks'>Facebook</a>!<br />
<br />Reviews help people feel more comfortable about the speed dating process, thereby increasing the number of new participants at future events, and leading to more potential matches! We're also offering 20% off any future event as a thank you for taking the time to write us a review.<br />
<br />Hope to see you again soon!<br />
<br />Sips and Sparks
`;

const NoInterestsText =
`We are sorry to hear that you didn't find that special spark you were looking for, but the good news is that we'll be hosting many more speed dating events in the future with tons of different people and possibilities!<br />
<br />Follow us on <a href='https://www.facebook.com/sipsandsparks'>Facebook</a>, <a href='https://instagram.com/sipsandsparks'>Instagram</a>, and <a href='https://www.eventbrite.com/o/sips-and-sparks-73343957833'>Eventbrite</a> to stay up to date on all future speed dating events and receive exclusive promo codes!<br />
<br />We are a new organization so please help us spread the word by telling all of your single friends and family members about our events!<br />
<br />Hope to see you again soon!<br />
<br />Sips and Sparks
`;

const NoMatchesNoRevisitsText =
`Unfortunately you did not have any mutual matches this time around, but we'll be hosting many more speed dating events in the future with tons of different people and possibilities!<br />
<br />Follow us on <a href='https://www.facebook.com/sipsandsparks'>Facebook</a>, <a href='https://instagram.com/sipsandsparks'>Instagram</a>, and <a href='https://www.eventbrite.com/o/sips-and-sparks-73343957833'>Eventbrite</a> to stay up to date on all future speed dating events and receive exclusive promo codes!<br />
<br />We are a new organization so please help us spread the word by telling all of your single friends and family members about our events!<br />
<br />Hope to see you again soon!<br />
<br />Sips and Sparks
`;

const MatchesTransporter = nodemailer.createTransport({
    host: 'smtp.zoho.com',
    port: 465,
    secure: true,
    auth: {
        user: MatchesEmail,
        pass: EmailPassword
    }
});

const pool = new Pool({
    connectionString: DatabaseURL,
    ssl: {
      rejectUnauthorized: false
    }
});

async function sendMatchEmail(attendee: Attendee, matches: Attendee[], revisits: Attendee[], eventName: string) {
    try {
        let matchText = `Hi ${attendee.firstName},<br /><br />Thank you so much for attending our event! We hope you had a great time!<br /><br />`;
        const filteredRevisits = revisits.filter((att) => att.sendContactToNonMutual);

        if (matches.length > 0) {
            matchText += `Your mutual matches and their contact information are as follows:<br />`;
            matches.forEach(match => {
                matchText += `${match.id} ${match.firstName} ${match.lastName}, ${match.email}${match.cellPhone ? (', ' + match.cellPhone) : ''}<br />`;
            });
        }

        if (filteredRevisits.length > 0) {
            if (matches.length > 0) {
                matchText += MatchesRevisitText;
            } else {
                matchText += OnlyRevisitsText;
            }
            filteredRevisits.forEach(revisit => {
                matchText += `${revisit.id} ${revisit.firstName} ${revisit.lastName}, ${revisit.email}${revisit.cellPhone ? (', ' + revisit.cellPhone) : ''}<br />`;
            });
        }

        if (matches.length > 0) {
            if (filteredRevisits.length > 0) {
                matchText += MatchesAndRevisitsText;
            }
            matchText += matchesText;
        } else if (filteredRevisits.length > 0) {
            matchText += OnlyRevisitsEndText;
        } else if (!attendee.interests || attendee.interests.length <= 0 || attendee.interests[0] === null) {
            matchText += NoInterestsText;
        } else {
            matchText += NoMatchesNoRevisitsText;
        }

        if (matches.length === 0 && revisits.length > filteredRevisits.length) {
            matchText += `\n<br />P.S. You also received interest from ${revisits.length - filteredRevisits.length} people who opted to not share their contact info with non-mutual matches.\n`;
        }

        // Define email options
        let mailOptions = {
            from: MatchesEmail,
            to: attendee.email,
            subject: `Sips & Sparks Matches - ${eventName}`,
            html: matchText
        };

        MatchesTransporter.sendMail(mailOptions, (error, _info) => {
            if (error) {
                console.error('Error sending matches email.', error.message);
                return ({message: 'Error sending matches email.'});
            }
        });
    } catch (e) {
        if (e instanceof Error) {
            console.error('Error sending matches email.', e.message);
        } else {
            console.error('Error sending matches email.');
        }
        return {message: 'Error sending matches email.'} as QueryError;
    }
};

async function sendFeedbackEmail(date: string, attendees: Attendee[]) {
    try {
        let matchText = `<u>Feedback</u>`;
        attendees.forEach(att => {
            if (att.feedback && att.feedback.replace(/\s+/g, '') !== '') {
            matchText += `<br />${att.firstName} ${att.lastName}: ${att.feedback}`;
            }
        });

        matchText += `<br /><br /><u>Where did you hear about us?</u>`
        attendees.forEach(att => {
            if (att.referralInfo && att.referralInfo.replace(/\s+/g, '') !== '') {
            matchText += `<br />${att.firstName} ${att.lastName}: ${att.referralInfo}`;
            }
        });

        matchText += `<br /><br /><u>Do you have any website feedback?</u>`
        attendees.forEach(att => {
            if (att.websiteFeedback && att.websiteFeedback.replace(/\s+/g, '') !== '') {
            matchText += `<br />${att.firstName} ${att.lastName}: ${att.websiteFeedback}`;
            }
        });

        let mailOptions = {
            from: MatchesEmail,
            to: ContactEmail,
            subject: `Event Feedback - ${date}`,
            html: matchText
        };

        // Send email
        MatchesTransporter.sendMail(mailOptions, (error, _info) => {
            if (error) {
                console.error('Error sending feedback email.', error.message);
                return ({message: 'Error sending feedback email.'});
            }
        });
    } catch (e) {
        if (e instanceof Error) {
            console.error('Error sending matches email.', e.message);
        } else {
            console.error('Error sending matches email.');
        }
        return {message: 'Error sending matches email.'} as QueryError;
    }
}

async function getEventsFromEventbrite() {
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
                const eventEndDate = new Date(event.end.utc);
                const timeDifference = currentDate.getTime() - eventEndDate.getTime();
                const hoursDifference = timeDifference / (1000 * 60 * 60);
                return hoursDifference >= 0 && hoursDifference <= 24 && !alreadySentEmailsEventIds.has(event.id);
            }).map((event) => {
                const eventEndDate = new Date(event.end.utc);
                const month = String(eventEndDate.getMonth() + 1);
                const day = eventEndDate.getDate();
                return ({id: event.id, date: `${month}/${day}`});
            });

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
            interests: (att.interests && att.interests !== '--') ? att.interests.split(',').map(Number) : [],
            feedback: att.feedback,
            referralInfo: att.referral_info,
            cellPhone: att.cell_phone,
            inAttendance: att.in_attendance,
            websiteFeedback: att.website_feedback ?? '',
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

async function checkForEventsAndSendEmails() {
    const pastEvents = await getEventsFromEventbrite();
    if (isQueryError(pastEvents)) {
        console.error(pastEvents.message);
        return;
    }
    
    if (pastEvents.length === 0) {
      return;
    }

    pastEvents.forEach(async (event) => {
        const attendees = await getAttendeesFromDatabase(event.id);
        if (isQueryError(attendees)) {
            console.error(attendees.message);
            return;
        };

        const matches: Record<string, Attendee[]> = {};
        const revisits: Record<string, Attendee[]> = {};
        for (const att of attendees) {
            const genderToCheck = att.gender === Gender.MALE ? Gender.FEMALE : Gender.MALE;
            matches[`${att.gender}${att.id}`] = [];
            revisits[`${att.gender}${att.id}`] = [];

            attendees.forEach(attendee => {
                if (attendee.gender === genderToCheck) {
                    if (attendee.interests?.includes(att.id) && att.interests?.includes(attendee.id)) {
                        matches[`${att.gender}${att.id}`].push(attendee);
                    } else if (attendee.interests?.includes(att.id)) {
                        revisits[`${att.gender}${att.id}`].push(attendee);
                    }
                }
            });
        }

        // Send emails
        console.log('Starting emailer for event ' + event.id);
        for (const matchId of Object.keys(matches)) {
            let regex = /^(Male|Female)(\d+)$/;
            let regexMatches = matchId.match(regex);
            if (regexMatches) {
                const gender = regexMatches[1];
                const attId = regexMatches[2];
                const attendee = attendees.find((att) => att.gender === gender && att.id === Number(attId));
                if (!attendee || !attendee.inAttendance) {
                    console.error('Attendee not found or not in attendance: ' + gender + attId);
                } else {
                    // Send this attendee an email with their matches
                    await sendMatchEmail(attendee, matches[matchId], revisits[matchId], event.date);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }
        }
        await sendFeedbackEmail(event.date, attendees);
        alreadySentEmailsEventIds.add(event.id);
    });
}

checkForEventsAndSendEmails()
    .then(_res => {
        console.log('Emailer done!');
      })
      .catch(error => {
        console.error('Emailer Error:', error);
      });