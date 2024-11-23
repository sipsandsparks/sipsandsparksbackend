const eventbrite = require('../controllers/eventbrite')
const { isQueryError } = require('../shared')

const events = async (_, res) => {
  const isAuth = res.locals.isAuth ?? false
  try {
    const events = await eventbrite.getEventsFromEventbrite(isAuth)
    if (isQueryError(events)) {
      //TODO: I would think eventbrite returns a non-2XX code in the event it has an error
      // and thus this code would be unreachable. Need to research API to confrim and then
      // we can delete this
      throw new Error(events.message)
    }
    if (isAuth) {
      res.json({ events: events.slice(40, 45) })
    } else {
      res.json({ events: events })
    }
  } catch (e) {
    console.error('Unknown error in /events:', e.message)
    res.json({ error: 'Error getting events.' })
  }
}

module.exports = events
