const db = require('../controllers/db')
const { capitalizeName, normalizeString } = require('../utils')
const { isQueryError } = require('../shared')

const match = async (req, res) => {
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
    console.error('Unknown error in /match endpoint:', e.message)
    res.json({ error: 'Error submitting match form.' })
  }
}

module.exports = match
