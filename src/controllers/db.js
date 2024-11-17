const { isAttendeePresent, getPublicAttendeeName } = require('../utils/utils')

const db = require('../services/db')
const eventbrite = require('./eventbrite')

const getAttendeesFromDatabaseToRemind = async (eventId) => {
  let result
  try {
    result = await db.query(
      `
              SELECT first_name, email
              FROM event_attendees
              WHERE event_id = $1 AND in_attendance = true AND interests IS NULL
          `,
      [eventId]
    )
    result.rows.map((att) => ({
      firstName: att.first_name,
      email: att.email
    }))
  } catch (e) {
    console.error('Error fetching participants from database:', e.message)
  }
  return result
}

const addAttendeesToDatabase = async (eventId, attendees) => {
  try {
    const args = attendees.map((att) => {
      return [eventId, att.firstName, att.lastName, att.email, att.gender, att.id]
    })
    await db.transaction(
      `
        INSERT INTO event_attendees (event_id, first_name, last_name, email, gender, attendee_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (event_id, email) 
        DO UPDATE SET 
          first_name = EXCLUDED.first_name, 
          last_name = EXCLUDED.last_name, 
          gender = EXCLUDED.gender, 
          attendee_id = EXCLUDED.attendee_id
      `,
      args
    )
  } catch (e) {
    console.error('Error adding participants to database:', e.message)
  }
}

const updateAttendeeAttendance = async (eventId, email) => {
  try {
    await db.query(
      `
        UPDATE event_attendees
        SET in_attendance = true
        WHERE event_id = $1 and email = $2
      `,
      [eventId, email]
    )
  } catch (e) {
    console.error('Error updating attendance in database.', e.message)
  } finally {
    client.release()
  }
}

const addMatchFormSubmissionToDatabase = async (
  eventId,
  email,
  interests,
  feedback,
  referralInfo,
  cellPhone,
  notes,
  websiteFeedback,
  sendContactToNonMutual
) => {
  try {
    await db.query(
      `
        UPDATE event_attendees
        SET interests = $1,
            feedback = $2,
            referral_info = $3,
            cell_phone = $4,
            notes = $5,
            website_feedback = $6,
            send_contact_to_non_mutual = $7
        WHERE event_id = $8 AND email = $9
      `,
      [interests, feedback, referralInfo, cellPhone, notes, websiteFeedback, sendContactToNonMutual, eventId, email]
    )
  } catch (e) {
    console.error('Error adding match form submission to database.', e.message)
  } finally {
    client.release()
  }
}

const getAttendeesFromDatabase = async (eventId) => {
  try {
    const result = await db.query(
      `
        SELECT *
        FROM event_attendees
        WHERE event_id = $1
      `,
      [eventId]
    )

    const attendees = result.rows.map((att) => ({
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
      interests: att.interests && att.interests !== '--' ? att.interests.split(',').map(Number) : [],
      websiteFeedback: att.website_feedback ?? undefined,
      sendContactToNonMutual: att.send_contact_to_non_mutual ?? false
    }))

    return attendees.sort((a, b) => a.id - b.id)
  } catch (e) {
    console.error('Error fetching participants from database.', e.message)
  } finally {
    client.release()
  }
}

const setEventMatchFormData = async (
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
) => {
  // Make sure the matches are numbers
  if (matches.some((str) => isNaN(parseInt(str)) || parseInt(str) === 0) || matches.length > 50) {
    // Someone is trying to send malicious requests
    console.log('Invalid interest selections.')
    console.log(matches)
    return { message: 'Invalid interest selections.' }
  }

  const eventsList = await eventbrite.getEventsFromEventbrite()
  if (isQueryError(eventsList)) {
    return eventsList
  }

  if (!eventsList.some((e) => e.id === eventId)) {
    return { message: 'Submissions for this event are now closed.' }
  }

  const attendees = await getAttendeesFromDatabase(eventId)
  if (isQueryError(attendees)) {
    return attendees
  }

  const isValidAttendee = isAttendeePresent(firstName, lastName, email, attendees)
  const ourAttendee = attendees.find((att) => att.email === email)
  if (!isValidAttendee || !ourAttendee) {
    return { message: 'Participant not found in the database.' }
  }

  const interests = matches.length > 0 ? matches.sort().join(',') : '--'
  const queryResult = await addMatchFormSubmissionToDatabase(
    eventId,
    email,
    interests,
    feedback,
    referralInfo,
    cellPhone,
    notes,
    websiteFeedback ?? '',
    sendContactToNonMutual
  )
  if (isQueryError(queryResult)) {
    return queryResult
  }

  const oppositeGenderAttendees = attendees.filter((att) => att.gender !== ourAttendee.gender)
  const interestPeople = oppositeGenderAttendees
    .filter((att) => matches.includes(String(att.id)))
    .map((att) => ({ ...att, firstName: getPublicAttendeeName(att, oppositeGenderAttendees) }))
  await sendConfirmationEmail(ourAttendee, notes, interestPeople)
  //TODO: move this up
}

module.exports = {
  getAttendeesFromDatabaseToRemind,
  addAttendeesToDatabase,
  addMatchFormSubmissionToDatabase,
  updateAttendeeAttendance,
  getAttendeesFromDatabase,
  setEventMatchFormData
}
