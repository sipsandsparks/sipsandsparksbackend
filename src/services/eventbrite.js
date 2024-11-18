const axios = require('axios')

const EventbriteToken = process.env.EVENTBRITE_TOKEN

const get = async (url) => {
  let currentPage = 1
  let checkNextPage = true
  let data = []
  try {
    while (checkNextPage) {
      const response = await axios.get(`${url}/?page=${currentPage}`, {
        headers: {
          Authorization: `Bearer ${EventbriteToken}`
        }
      })
      data.push(...response.data.events)
      if (!data.pagination?.has_more_items) {
        checkNextPage = false
      } else {
        currentPage += 1
      }
    }
  } catch (e) {
    console.error('EVENTBRITE SERVICE ERROR:', e.message)
  }
  return data
}

module.exports = { get }
