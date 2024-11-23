const { normalizeString } = require('../utils')

const AdminEmail = process.env.ADMIN_EMAIL
const AdminPassword = process.env.ADMIN_PASSWORD

//Safe to store our auth in res.locals per: https://expressjs.com/en/api.html#res.locals
const authenticateUser = (req, res, next) => {
  const { username, password } = req.body
  const normalizedUsername = normalizeString(username)
  if (normalizedUsername === AdminEmail && password === AdminPassword) {
    res.locals.isAuth = true
    next()
  } else {
    res.send(403).json({ error: 'Incorrect username or password' })
  }
}

module.exports = authenticateUser
