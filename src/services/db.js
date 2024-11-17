const { Pool } = require('pg')

const DatabaseURL = process.env.DATABASE_URL

const pool = (() => {
  if (process.env.NODE_ENV !== 'production') {
    return new Pool({
      connectionString: DatabaseURL,
      ssl: false
    })
  } else {
    return new Pool({
      connectionString: DatabaseURL,
      ssl: {
        rejectUnauthorized: false
      }
    })
  }
})()

const query = async (query, args, isTransaction = false) => {
  const client = await pool.connect()
  let result
  try {
    result = await client.query(query, args)
  } catch (e) {
    console.error('Error connecting to database:', e.message)
  } finally {
    client.release()
  }
  return result
}

const transaction = async (query, args) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const queries = args.map((arg) => {
      return client.query(query, arg)
    })
    await Promise.all(queries)
    await client.query('COMMIT')
  } catch (e) {
    console.error('Error connecting to database:', e.message)
  } finally {
    client.release()
  }
}

const seed = async () => {
  const client = await pool.connect()
  await client.query('BEGIN')
  // await client.query('DROP TABLE event_attendees;')
  await client.query(
    `
      DROP TABLE IF EXISTS event_attendees;
      CREATE TABLE event_attendees(
        id serial primary key not null,
        first_name text,
        last_name text,
        email text,
        event_id text,
        in_attendance text,
        interests text,
        gender text,
        attendee_id text,
        feedback text,
        referall_info text,
        cell_phone text,
        notes text,
        website_feedback text,
        send_contact_to_non_mutual text,
        UNIQUE(event_id, email)
      );      
    `
  )
  await client.query('COMMIT')
  await client.release()
}

module.exports = {
  query,
  transaction,
  seed
}
