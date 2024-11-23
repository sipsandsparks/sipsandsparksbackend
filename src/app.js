const express = require('express')
const cors = require('cors')
const { CronJob } = require('cron')
const winston = require('express-winston')
const { transports, format } = require('winston')

const contact = require('./contact')
const events = require('./events')
const eventParticipants = require('./eventParticipants')
const match = require('./match')
const authenticateUser = require('./middlewares/authenticateUser')
const { scheduleReminderEmailsForToday } = require('./controllers/eventbrite')

const clientUrl = process.env.NODE_ENV === 'dev' ? 'http://localhost:8080' : 'https://sipsandsparks.org'

const app = express()

const reminderJob = new CronJob('0 0 * * *', async () => {
  console.log('Scheduling Cron job for reminder emails.')
  // scheduleReminderEmailsForToday()
})
reminderJob.start()

app.use(express.json())
app.use(
  cors({
    origin: clientUrl
  })
)
app.use(
  winston.logger({
    transports: [new transports.Console()],
    format: format.json()
  })
)

app.post('/contact', contact)

app.get('/events', events)

//TODO: Rename to /admin/events during UI refactor for RESTful consistency
app.post('/admin/login', authenticateUser, events)

app.post('/admin/event-participants', authenticateUser, eventParticipants)

app.post('/event-participants', eventParticipants)

app.post('/match', match)

//TODO: This is a DB seeding function for local testing. I will delete.
// const j = require('../data/791645953357_attendees.json')
const { seed } = require('./services/db')
app.get('/seed', async (_, res) => {
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
