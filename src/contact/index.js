const nodemailer = require('nodemailer')
const { normalizeString } = require('../utils')

const ContactEmail = 'contact@sipsandsparks.org'
const EmailPassword = process.env.EMAIL_PASSWORD

const ContactTransporter = nodemailer.createTransport({
  host: 'smtp.zoho.com',
  port: 465,
  secure: true,
  auth: {
    user: ContactEmail,
    pass: EmailPassword
  }
})

const contact = async (req, res, next) => {
  try {
    const { message, email, name } = req.body
    let mailOptions = {
      from: ContactEmail,
      to: ContactEmail,
      subject: `Contact Query - ${name}`,
      text: `Message from: ${name}\nEmail: ${normalizeString(email)}\n\n${message}`
    }

    await ContactTransporter.sendMail(mailOptions)

    res.status(200).json()
  } catch (e) {
    console.error('Unknown error in /contact:', e.message)
    res.json({ error: 'Error submitting contact query.' })
    //TODO: determine if UI allows us to return 500 on failure instead of 200.
    // next(e)
  }
}

module.exports = contact
