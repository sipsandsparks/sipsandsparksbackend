const eventbrite = require('../services/eventbrite')

const { sendReminderEmails } = require('../services/emails')
const {
  removeDuplicateEmailsFromAttendees,
  normalizeString,
  capitalizeName,
  EventbriteTicketClassToGender
} = require('../utils/utils')

const eventbriteOrg = process.env.EVENTBRITE_ORG

const getEventsFromEventbrite = async (getAll = false) => {
  let events
  try {
    const data = await eventbrite.get(
      `https://www.eventbriteapi.com/v3/organizations/${eventbriteOrg}/events`,
      'events'
    )
    const currentDate = new Date()
    events = data
      .filter((event) => {
        if (getAll) {
          return true
        }

        const eventStartDate = new Date(new Date(event.start.utc).getTime() - 8 * 60 * 60 * 1000)
        // Check if the event has already started
        if (currentDate >= eventStartDate) {
          // Check if we are still earlier than the day after the event at 9am (when matches are sent)
          const eventFormDeadline = new Date(event.start.utc)
          eventFormDeadline.setUTCDate(eventFormDeadline.getUTCDate() + 1)
          eventFormDeadline.setUTCHours(12, 55, 0, 0)
          return currentDate < eventFormDeadline
        }
        return false // Event hasn't started yet
      })
      .map((event) => ({ id: event.id, name: event.name.text, start: event.start.local }))
  } catch (e) {
    console.error('EVENTBRITE CONTROLLER ERROR:', e.message)
  }
  return events
}

const getAttendeesFromEventbrite = async (eventId) => {
  let filteredAttendees = []
  try {
    const data = await eventbrite.get(`https://www.eventbriteapi.com/v3/events/${eventId}/attendees`, 'attendees')
    const attendees = data
      .filter((att) => att.status === 'Attending')
      .map((att) => ({
        firstName: capitalizeName(att.profile.first_name),
        lastName: capitalizeName(att.profile.last_name),
        email: normalizeString(att.profile.email),
        gender: EventbriteTicketClassToGender(att.ticket_class_name),
        id: 0
      }))
    filteredAttendees = removeDuplicateEmailsFromAttendees(attendees)
  } catch (e) {
    console.error('EVENTBRITE CONTROLLER ERROR:', e.message)
  }
  return filteredAttendees
}

const scheduleReminderEmailsForToday = async () => {
  try {
    const data = await eventbrite.get(`https://www.eventbriteapi.com/v3/organizations/${eventbriteOrg}/events`)

    const currentDate = new Date()
    const events = data.events.filter((event) => {
      const eventEndDate = new Date(event.end.utc)
      const timeDifference = currentDate.getTime() - eventEndDate.getTime()
      const hoursDifference = timeDifference / (1000 * 60 * 60)
      return hoursDifference > 0 && hoursDifference <= 24
    })

    events.forEach((event) => {
      const eventEndDate = new Date(event.end.utc)
      const reminderTime = new Date(eventEndDate.getTime() + 60 * 60 * 1000)
      const delay = reminderTime.getTime() - currentDate.getTime()
      if (delay > 0) {
        setTimeout(async () => {
          console.log(`Sending reminders for event id: ${event.id}`)
          await sendReminderEmails(event.id)
        }, delay)
      } else {
        console.log(`The event id ${event.id} has already passed the 1-hour mark. Reminders will not be sent.`)
      }
    })
  } catch (e) {
    console.error('Error scheduling reminder emails:', e.message)
  }
}

module.exports = { getEventsFromEventbrite, getAttendeesFromEventbrite, scheduleReminderEmailsForToday }
