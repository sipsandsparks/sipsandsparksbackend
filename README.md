## Sips and Sparks API

This is an experience API using express routing and PostgreSQL as a dabase.

## Routes

| VERB | ROUTE                     | EFFECT                                                                             |
| ---- | ------------------------- | ---------------------------------------------------------------------------------- |
| POST | \contact                  | Sends an email to ourselves, from ourselves, with message provided in request body |
| GET  | \events                   | Get all future events from Eventbrite                                              |
| POST | \admin\login              | Get all events from Eventbrite                                                     |
| POST | \admin\event-participants | Gets attendees from DB and Eventbrite, adds attendees to DB if they are missing    |
| POST | \event-participants       | Initializes the DB for a particular event?                                         |
| POST | \match                    | Add matches for a particular user to the DB                                        |

## Local development

You'll want to install Postgresql and run a local server.

```
EVENTBRITE_TOKEN=<secret>
EVENTBRITE_ORG=<secret>
DATABASE_URL="postgres://<server_name>:<password>@localhost:5432/<db_name>"
EMAIL_PASSWORD=<secret>
ADMIN_FIRST_NAME="John"
ADMIN_LAST_NAME="Smith"
ADMIN_EMAIL=<secret>
ADMIN_PASSWORD=<secret>
```
