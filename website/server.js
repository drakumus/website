const express = require('express')
const path = require('path')
const drops_db = require('./src/js/drops_db')
const cors = require('cors');
var bodyParser = require('body-parser')
var jsonParser = bodyParser.json()

const app = express()

const corsConfig = {
  credentials: true,
  origin: true
}

app.use(
  cors()
)

// parse application/json
app.use(bodyParser.json())

app.use(express.static(path.join(__dirname, './src')))
app.use(express.static(path.join(__dirname, './src/react/drops/build')))

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, `./src/index.html`))
})

app.get('/drops/static_members', async (req, res) => {
  res.send(await drops_db.getUsers())
})

app.get('/drops/active_static_members', async (req, res) => {
  res.send(await drops_db.getActiveStaticMembers())
})

app.get('/drops/main_drops', async (req, res) => {
  res.send(await drops_db.getMainDrops())
})

app.get('/drops/alt_drops', async (req, res) => {
  res.send(await drops_db.getAltDrops())
})

app.get('/drops/bis', async (req, res) => {
  res.send(await drops_db.getStaticBis())
})

app.post('/drops/log_drops', jsonParser, async (req, res) => {
  console.log("here")
  console.log(req.body);
  let data = req.body
  if (data.admin_key !== "wah4reward")
  {
    res.status(403).send("Invalid admin key.")
  } else
  {
    let result = await drops_db.storeDrop(data.player_id, data.item_type_index, data.with_static, data.is_main)
    res.status(201).send(result)
  }
})

app.get('/drops', (req, res) => {
  res.sendFile(path.join(__dirname, `./src/react/drops/build/index.html`))
})

app.get('/attendance/static', async (req, res) => {
  res.send(await drops_db.getAttendance())
})

app.post('/attendance/log_attendance', jsonParser, async (req, res) => {
  console.log(req.body)
  let body = req.body
  let data = req.body.data
  if (body.admin_key !== "wah4reward")
  {
    res.status(403).send("Invalid admin key.")
  } else
  {
    let result = await drops_db.storeAttendance(data)
    res.status(201).send(result)
  }
})

app.get('/attendance', (req, res) => {
  res.sendFile(path.join(__dirname, "./src/react/attendance/build/index.html"))
})

app.listen(5000, () => console.log('Server is up and running'))
