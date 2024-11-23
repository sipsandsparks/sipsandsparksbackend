const eventbrite = require('../controllers/eventbrite')
const db = require('../controllers/db')
const { Gender, isQueryError } = require('../shared')
const {
  normalizeString,
  capitalizeName,
  isAdminInfo,
  isAttendeePresent,
  sortAttendees,
  assignIDToAttendees,
  makePublicAttendees
} = require('../utils')

const eventParticipants = async (req, res) => {
  try {
    const { eventId, firstName, lastName, email } = req.body
    const normalizedFirstName = capitalizeName(firstName)
    const normalizedLastName = capitalizeName(lastName)
    const normalizedEmail = normalizeString(email)

    const isAuth = res.locals ?? false
    const isAdmin = isAdminInfo(normalizedFirstName, normalizedLastName, normalizedEmail)
    if (
      !isAuth &&
      !isAdmin &&
      !isAttendeePresent(normalizedFirstName, normalizedLastName, normalizedEmail, eventbriteAttendees)
    ) {
      res.json({ error: 'Participant is not present in Eventbrite.' })
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
    if (isAuth) {
      const publicAttendees = makePublicAttendees(allAttendees, Gender.MALE)
      res.json({ public_attendees: publicAttendees, admin_attendees: allAttendees })
    } else if (isAdmin) {
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
    console.error('Unknown error in /event-participants:', e.message)
    res.json({ error: 'Error getting event participants.' })
  }
}

module.exports = eventParticipants
