const Gender = {
  MALE: 'Male',
  FEMALE: 'Female',
  OTHER: 'Other'
}

const isQueryError = (obj) => {
  return obj && typeof obj.message === 'string'
}

module.exports = { isQueryError, Gender }
