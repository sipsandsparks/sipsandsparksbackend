const nodemailer = require('nodemailer')

const { getAttendeesFromDatabaseToRemind } = require('./db')

const MatchesEmail = 'matches@sipsandsparks.org'
const EmailPassword = process.env.EMAIL_PASSWORD

const MatchesTransporter = nodemailer.createTransport({
  host: 'smtp.zoho.com',
  port: 465,
  secure: true,
  auth: {
    user: MatchesEmail,
    pass: EmailPassword
  }
})

const sendReminderEmail = async (firstName, email) => {
  try {
    let matchText = `Dear ${firstName},<br /><br />Thank you for attending our event! We noticed that we haven't received your match form submission yet. If this was an oversight, please finalize your choices and submit your match form <a href='https://sipsandsparks.org/match'>here</a>.<br /><br />`
    matchText += `If you did not feel you found a meaningful connection this time around, don't worry, we'll be hosting many more speed dating events in the future with tons of different people and possibilities!<br /><br />`
    matchText += `Follow us on <a href='https://www.facebook.com/sipsandsparks'>Facebook</a>, <a href='https://instagram.com/sipsandsparks'>Instagram</a>, and <a href='https://www.eventbrite.com/o/sips-and-sparks-73343957833'>Eventbrite</a> to stay up to date on all future speed dating events and receive exclusive promo codes!<br /><br />`
    matchText += `With Love,<br />Sips and Sparks Team`

    // Define email options
    let mailOptions = {
      from: 'matches@sipsandsparks.org',
      to: email,
      subject: `Last Chance to Submit Your Match Form`,
      html: matchText
    }

    MatchesTransporter.sendMail(mailOptions, (error, _info) => {
      if (error) {
        console.error('Error sending reminder email.', error.message)
      }
    })
  } catch (e) {
    if (e instanceof Error) {
      console.error('Error sending reminder email.', e.message)
    } else {
      console.error('Error sending reminder email.')
    }
  }
}

const sendReminderEmails = async (eventId) => {
  //TODO: Move up this call so we dont have service <-> service communication
  const attendees = await getAttendeesFromDatabaseToRemind(eventId)
  if (isQueryError(attendees) || attendees.length === 0) {
    return
  }

  for (const att of attendees) {
    void sendReminderEmail(att.firstName, att.email)
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
}

const sendConfirmationEmail = (attendee, notes, interestPeople) => {
  try {
    let confirmationText = `Dear ${attendee.firstName},\n\nThank you for attending our event. We have received your submission. Below is a copy of the information you provided:`
    if (interestPeople.length > 0) {
      confirmationText += `\n\nWho would you like to see again after today?:`
      interestPeople.forEach((person) => {
        confirmationText += `\n- ${person.id} ${person.firstName}`
      })
    }
    if (notes.replace(/\s+/g, '') !== '') {
      confirmationText += `\n\nNotes:\n${notes}`
    }
    confirmationText += `\n\nThank you once again for participating. You can expect your match results via email within 24 hours.\n\nWith Love,\nSips and Sparks`

    const mailOptions = {
      from: MatchesEmail,
      to: attendee.email,
      subject: `Confirmation of Your Match Form Submission`,
      text: confirmationText
    }

    MatchesTransporter.sendMail(mailOptions, (error, _info) => {
      if (error) {
        console.error('Error sending confirmation email.', error.message)
        return { message: 'Error sending confirmation email.' }
      }
    })
  } catch (e) {
    if (e instanceof Error) {
      console.error('Error sending confirmation email.', e.message)
    } else {
      console.error('Error sending confirmation email.')
    }
    return { message: 'Error sending confirmation email.' }
  }
}

module.exports = { sendReminderEmails, sendConfirmationEmail }
