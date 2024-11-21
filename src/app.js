const nodemailer = require('nodemailer')
const express = require('express')
const cors = require('cors')
const { CronJob } = require('cron')
const { Gender, isQueryError } = require('./shared')

const {
  normalizeString,
  capitalizeName,
  isAdminInfo,
  isAttendeePresent,
  sortAttendees,
  assignIDToAttendees,
  makePublicAttendees
} = require('./utils/utils')

const eventbrite = require('./controllers/eventbrite')
const db = require('./controllers/db')

const app = express()
const AdminEmail = process.env.ADMIN_EMAIL
const AdminPassword = process.env.ADMIN_PASSWORD
const ContactEmail = 'contact@sipsandsparks.org'
const EmailPassword = process.env.EMAIL_PASSWORD

const ContactTransporter = nodemailer.createTransport({
  host: 'smtp.zoho.com',
  port: 465,
  secure: true,
  auth: {
    user: 'contact@sipsandsparks.org',
    pass: EmailPassword
  }
})

const reminderJob = new CronJob('0 0 * * *', async () => {
  console.log('Scheduling Cron job for reminder emails.')
  scheduleReminderEmailsForToday()
})
reminderJob.start()

app.use(express.json())
app.use(
  cors({
    origin: 'https://sipsandsparks.org'
  })
)

//Works: sends email to ourselves, from ourselves.
app.post('/contact', (req, res) => {
  try {
    const { message, email, name } = req.body

    let mailOptions = {
      from: ContactEmail,
      to: ContactEmail,
      subject: `Contact Query - ${name}`,
      text: `Message from: ${name}\nEmail: ${normalizeString(email)}\n\n${message}`
    }

    ContactTransporter.sendMail(mailOptions, (error, _info) => {
      if (error) {
        console.error('Error submitting contact query.', error.message)
        res.json({ error: 'Error submitting contact query.' })
        return
      }
    })

    res.status(200).json()
  } catch (e) {
    if (e instanceof Error) {
      console.error('Unknown error in contact endpoint.', e.message)
    } else {
      console.error('Unknown error in contact endpoint.')
    }
    res.json({ error: 'Error submitting contact query.' })
  }
})

app.get('/events', async (_, res) => {
  try {
    const events = await eventbrite.getEventsFromEventbrite()
    if (isQueryError(events)) {
      res.json({ error: events.message })
      return
    }
    res.json({ events: events })
  } catch (e) {
    if (e instanceof Error) {
      console.error('Unknown error in events endpoint.', e.message)
    } else {
      console.error('Unknown error in events endpoint.')
    }
    res.json({ error: 'Error getting events.' })
  }
})

app.post('/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body
    const normalizedUsername = normalizeString(username)
    if (normalizedUsername === AdminEmail && password === AdminPassword) {
      const events = await eventbrite.getEventsFromEventbrite(true)
      if (isQueryError(events)) {
        res.json({ error: events.message })
        return
      }
      res.json({ events: events.slice(40, 45) })
    } else {
      res.json({ error: 'Incorrect username or password.' })
    }
  } catch (e) {
    if (e instanceof Error) {
      console.error('Unknown error in admin login endpoint.', e.message)
    } else {
      console.error('Unknown error in admin login endpoint.')
    }
    res.json({ error: 'Internal Error encountered while trying to login.' })
  }
})

app.post('/admin/event-participants', async (req, res) => {
  try {
    const { eventId, username, password } = req.body
    const normalizedUsername = normalizeString(username)

    if (!(normalizedUsername === AdminEmail && password === AdminPassword)) {
      res.json({ error: 'Incorrect username or password.' })
      return
    }

    const eventbriteAttendees = await eventbrite.getAttendeesFromEventbrite(eventId)
    if (isQueryError(eventbriteAttendees)) {
      res.json({ error: eventbriteAttendees.message })
      return
    }

    const databaseAttendees = await db.getAttendeesFromDatabase(eventId)
    if (isQueryError(databaseAttendees)) {
      res.json({ error: databaseAttendees.message })
      return
    }

    let allAttendees
    if (databaseAttendees.length === 0) {
      // This is the first request for this event. We must initialize the database.
      const sortedAttendees = sortAttendees(eventbriteAttendees)
      const maleAttendees = assignIDToAttendees(sortedAttendees.filter((att) => att.gender === Gender.MALE))
      const femaleAttendees = assignIDToAttendees(sortedAttendees.filter((att) => att.gender === Gender.FEMALE))
      allAttendees = [...maleAttendees, ...femaleAttendees]
      // Initialize the database
      const queryResult = await db.addAttendeesToDatabase(eventId, allAttendees)
      if (isQueryError(queryResult)) {
        res.json({ error: queryResult.message })
        return
      }
    } else {
      // We already have data in the database. Check if anyone new has been added to Eventbrite.
      const attendeesNotInDatabase = eventbriteAttendees.filter(
        (ebAtt) => !databaseAttendees.some((dbAtt) => dbAtt.email === ebAtt.email)
      )
      if (attendeesNotInDatabase.length > 0) {
        // There is someone in the Eventbrite list who is not yet in our database.
        const sortedNewAttendees = sortAttendees(attendeesNotInDatabase)
        // Assign them IDs starting from the last index of the attendees who already have IDs
        const newMaleAttendees = assignIDToAttendees(
          sortedNewAttendees.filter((att) => att.gender === Gender.MALE),
          databaseAttendees.filter((att) => att.gender === Gender.MALE).length
        )
        const newFemaleAttendees = assignIDToAttendees(
          sortedNewAttendees.filter((att) => att.gender === Gender.FEMALE),
          databaseAttendees.filter((att) => att.gender === Gender.FEMALE).length
        )
        const allNewAttendees = [...newMaleAttendees, ...newFemaleAttendees]
        allAttendees = [...databaseAttendees, ...allNewAttendees]

        // Add the new people to the database
        const queryResult = await db.addAttendeesToDatabase(eventId, allNewAttendees)
        if (isQueryError(queryResult)) {
          res.json({ error: queryResult.message })
          return
        }
      } else {
        allAttendees = databaseAttendees
      }
    }

    const publicAttendees = makePublicAttendees(allAttendees, Gender.MALE)
    res.json({ public_attendees: publicAttendees, admin_attendees: allAttendees })
  } catch (e) {
    console.error('Unknown error in admin event-participants endpoint.', e.message)
    res.json({ error: 'Error getting event participants.' })
  }
})

app.post('/event-participants', async (req, res) => {
  try {
    const { eventId, firstName, lastName, email } = req.body
    const normalizedFirstName = capitalizeName(firstName)
    const normalizedLastName = capitalizeName(lastName)
    const normalizedEmail = normalizeString(email)

    const eventbriteAttendees = await eventbrite.getAttendeesFromEventbrite(eventId)
    if (isQueryError(eventbriteAttendees)) {
      res.json({ error: eventbriteAttendees.message })
      return
    }

    const isAdmin = isAdminInfo(normalizedFirstName, normalizedLastName, normalizedEmail)
    if (!isAdmin && !isAttendeePresent(normalizedFirstName, normalizedLastName, normalizedEmail, eventbriteAttendees)) {
      res.json({ error: 'Participant is not present in Eventbrite.' })
      return
    }

    const databaseAttendees = await db.getAttendeesFromDatabase(eventId)
    if (isQueryError(databaseAttendees)) {
      res.json({ error: databaseAttendees.message })
      return
    }

    let allAttendees
    if (databaseAttendees.length === 0) {
      // This is the first request for this event. We must initialize the database.
      const sortedAttendees = sortAttendees(eventbriteAttendees)
      const maleAttendees = assignIDToAttendees(sortedAttendees.filter((att) => att.gender === Gender.MALE))
      const femaleAttendees = assignIDToAttendees(sortedAttendees.filter((att) => att.gender === Gender.FEMALE))
      allAttendees = [...maleAttendees, ...femaleAttendees]

      // Initialize the database
      const queryResult = await db.addAttendeesToDatabase(eventId, allAttendees)
      if (isQueryError(queryResult)) {
        res.json({ error: queryResult.message })
        return
      }
    } else {
      // We already have data in the database. Check if anyone new has been added to Eventbrite.
      const attendeesNotInDatabase = eventbriteAttendees.filter(
        (ebAtt) => !databaseAttendees.some((dbAtt) => dbAtt.email === ebAtt.email)
      )
      if (attendeesNotInDatabase.length > 0) {
        // There is someone in the Eventbrite list who is not yet in our database.
        const sortedNewAttendees = sortAttendees(attendeesNotInDatabase)
        // Assign them IDs starting from the last index of the attendees who already have IDs
        const newMaleAttendees = assignIDToAttendees(
          sortedNewAttendees.filter((att) => att.gender === Gender.MALE),
          databaseAttendees.filter((att) => att.gender === Gender.MALE).length
        )
        const newFemaleAttendees = assignIDToAttendees(
          sortedNewAttendees.filter((att) => att.gender === Gender.FEMALE),
          databaseAttendees.filter((att) => att.gender === Gender.FEMALE).length
        )
        const allNewAttendees = [...newMaleAttendees, ...newFemaleAttendees]
        allAttendees = [...databaseAttendees, ...allNewAttendees]

        // Add the new people to the database
        const queryResult = await addAttendeesToDatabase(eventId, allNewAttendees)
        if (isQueryError(queryResult)) {
          res.json({ error: queryResult.message })
          return
        }
      } else {
        allAttendees = databaseAttendees
      }
    }

    if (isAdmin) {
      res.json({ attendees: allAttendees })
    } else {
      db.updateAttendeeAttendance(eventId, normalizedEmail)
      const ourAttendee = allAttendees.find((att) => att.email === normalizedEmail)
      const publicAttendees = makePublicAttendees(allAttendees, ourAttendee?.gender ?? Gender.FEMALE)
      if (ourAttendee && ourAttendee?.notes !== undefined) {
        const previousInfo = {
          notes: ourAttendee.notes,
          feedback: ourAttendee.feedback ?? '',
          cellPhone: ourAttendee.cellPhone ?? '',
          interests: ourAttendee.interests ?? [],
          referralInfo: ourAttendee.referralInfo ?? '',
          websiteFeedback: ourAttendee.websiteFeedback ?? '',
          sendContactToNonMutual: ourAttendee.sendContactToNonMutual ?? false
        }
        res.json({ attendees: publicAttendees, previousInfo: previousInfo })
      } else {
        res.json({ attendees: publicAttendees })
      }
    }
  } catch (e) {
    console.error('Unknown error in event-participants endpoint.', e.message)
    res.json({ error: 'Error getting event participants.' })
  }
})

app.post('/match', async (req, res) => {
  try {
    const {
      eventId,
      firstName,
      lastName,
      email,
      matches,
      notes,
      feedback,
      referralInfo,
      cellPhone,
      websiteFeedback,
      sendContactToNonMutual
    } = req.body
    const normalizedFirstName = capitalizeName(firstName)
    const normalizedLastName = capitalizeName(lastName)
    const normalizedEmail = normalizeString(email)

    const queryResult = await db.setEventMatchFormData(
      eventId,
      normalizedFirstName,
      normalizedLastName,
      normalizedEmail,
      matches,
      notes,
      feedback,
      referralInfo,
      cellPhone,
      websiteFeedback,
      sendContactToNonMutual
    )
    if (isQueryError(queryResult)) {
      res.json({ error: queryResult })
      return
    }
    res.status(200).json()
  } catch (e) {
    console.error('Unknown error in match endpoint.', e.message)
    res.json({ error: 'Error submitting match form.' })
  }
})

//This is a DB seeding function for local testing. I will delete.
const j = require('../data/791645953357_attendees.json')
const { seed } = require('./services/db')
app.get('/seed', async (req, res) => {
  await seed()
  // await db.addAttendeesToDatabase(1, j)
  res.sendStatus(200)
})

//express global error handling: https://expressjs.com/en/guide/error-handling.html
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).send('Server error: please consult logs for more information.')
})

module.exports = app
