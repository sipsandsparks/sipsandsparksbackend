const { Gender } = require('../shared')

const AdminFirstName = process.env.ADMIN_FIRST_NAME
const AdminLastName = process.env.ADMIN_LAST_NAME
const AdminEmail = process.env.ADMIN_EMAIL

const removeDuplicateEmailsFromAttendees = (attendees) => {
  const seenEmails = new Set()
  return attendees.filter((att) => {
    if (seenEmails.has(att.email)) {
      return false
    } else {
      seenEmails.add(att.email)
      return true
    }
  })
}

const normalizeString = (str) => {
  return str.toLowerCase().trim()
}

const capitalizeName = (name) => {
  if (name.length === 0) {
    return name
  }

  const trimmedName = name.trim()

  return trimmedName.charAt(0).toUpperCase() + trimmedName.slice(1)
}

const isAdminInfo = (firstName, lastName, email) => {
  return firstName === AdminFirstName && lastName === AdminLastName && email === AdminEmail
}

const isAttendeePresent = (firstName, lastName, email, attendees) => {
  return attendees.some(
    (att) =>
      att.email === email &&
      normalizeString(att.firstName) === normalizeString(firstName) &&
      normalizeString(att.lastName) === normalizeString(lastName)
  )
}

const sortAttendees = (attendees) => {
  return attendees.sort((a, b) => {
    const firstNameA = a.firstName
    const firstNameB = b.firstName

    if (firstNameA < firstNameB) {
      return -1
    } else if (firstNameA > firstNameB) {
      return 1
    }

    // First names are the same, go by last name
    const lastNameA = a.lastName
    const lastNameB = b.lastName

    if (lastNameA < lastNameB) {
      return -1
    } else if (lastNameA > lastNameB) {
      return 1
    }
    return 0
  })
}

const assignIDToAttendees = (attendees, startingIndex) => {
  const baseIndex = startingIndex ?? 0
  return attendees.map((attendee, index) => ({ ...attendee, id: index + 1 + baseIndex }))
}

const getOppositeGenderOfAttendee = (email, attendees) => {
  const ourAttendee = attendees.find((att) => att.email === email)
  return GenderToOppositeGender[ourAttendee?.gender ?? Gender.FEMALE]
}

const getPublicAttendeeName = (attendee, attendees) => {
  const attendeesWithSameFirstName = attendees.filter(
    (att) => attendee.firstName === att.firstName && attendee.lastName !== att.lastName
  )
  if (attendeesWithSameFirstName.length > 0) {
    if (attendeesWithSameFirstName.some((att) => att.lastName[0] === attendee.lastName[0])) {
      return `${attendee.firstName} ${attendee.lastName.slice(0, 2)}`
    }
    return `${attendee.firstName} ${attendee.lastName.slice(0, 1)}`
  }
  return attendee.firstName
}

const makePublicAttendees = (attendees, gender) => {
  const filteredAttendees = attendees.filter((att) => att.gender !== gender)
  return filteredAttendees.map((att) => ({
    name: getPublicAttendeeName(att, filteredAttendees),
    id: att.id
  }))
}

const EventbriteTicketClassToGender = (ticketClass) => {
  switch (ticketClass) {
    case 'Male Ticket':
      return Gender.MALE
    case 'Female Ticket':
      return Gender.FEMALE
    default:
      return Gender.OTHER
  }
}

module.exports = {
  removeDuplicateEmailsFromAttendees,
  normalizeString,
  capitalizeName,
  isAdminInfo,
  isAttendeePresent,
  sortAttendees,
  assignIDToAttendees,
  getOppositeGenderOfAttendee,
  getPublicAttendeeName,
  makePublicAttendees,
  EventbriteTicketClassToGender
}
