const mysql = require("mysql2");

config = {
  host: process.env.HOST,//'zoci.me',
  user: process.env.USER,//'gui',
  password: process.env.PASS,//'7ufKb4gui!@',
  database: process.env.DATABASE//'website'
}

async function query(query_string)
{
  try
  {
    var connection = null
    connection = mysql.createConnection(config);

    try
    {
      let queryPromiseResult = await new Promise((resolve, reject) => {
        connection.query(query_string, (error, results, fields) => {
          if(error)
          {
            console.log("returning error")
            reject(error)
          } else
          {
            console.log("returning result")
            resolve(results)
          }
        });
      });

      return queryPromiseResult;
    } catch (err)
    {
      console.log(err)
      return {"error": err}
    } finally
    {
      connection.destroy()
    }

  } catch (err)
  {
    console.log(err)
  }

}

async function getUsers()
{
  let result = await query("SELECT * FROM users;").catch(e => {
    console.log(e)
    return {"error": e}
  })
  return result
}

async function getMainDrops()
{
  let result = await query("SELECT * FROM main_drops;")
  return result
}

async function getAltDrops()
{
  let result = await query("SELECT * FROM alt_drops;")
  return result
}

async function getStaticBis()
{
  let result = await query("SELECT * FROM player_bis;")
  return result
}

async function storeDrop(player_id, item_type, with_static, is_main)
{
  console.log(`${player_id} ${item_type} ${with_static} ${is_main}`)
  let drops_table = is_main ? "main_drops" : "alt_drops"
  let query_string = `INSERT INTO \`${drops_table}\` (\`player_id\`, \`item_type\`, \`date_received\`, \`with_static\`) VALUES ('${player_id}', '${item_type}', '${new Date().toISOString().slice(0, 19).replace('T', ' ')}', '${with_static ? 1 : 0}')`
  console.log(query_string)
  let result = await query(query_string)
  return result
}

if(0)
{
  async function test() {
    let result = await storeDrop(4, 5, true, true)
    console.log(result)
  }
  test();
}

// @return Array of Jsons containing player attendance data:
// name
// attendance_day
// minutes_late
async function getAttendance()
{
  let result = await query("SELECT * FROM attendance;")
  return result
}

// Array of Jsons containing player attendance data:
// name
// attendance_day
// minutes_late
async function storeAttendance(player_attendances)
{
  let users_raw = getUsers()
  let users = {}
  for(let user_index in users_raw)
  {
    let user = users_raw[user_index]
    users[user.display_name] = user.id
  }

  let query_string = ""
  for(let data_point in player_attendances)
  {
    console.log(`${users[data_point.name]} ${new Date().toISOString().slice(0, 19).replace('T', ' ')} ${data_point.minutes_late}`)
    query_string += `INSERT INTO \`attendance\` (\`user_id\`, \`attendance_day\`, \`minutes_late\`) VALUES ('${users[data_point.name]}', '${new Date().toISOString().slice(0, 19).replace('T', ' ')}', '${data_point.minutes_late}');`
  }

  console.log(query_string)
  let result = await query(query_string)
  return result
}

module.exports = {
  query,
  getUsers,
  getMainDrops,
  getAltDrops,
  getStaticBis,
  getAttendance,
  storeDrop,
  storeAttendance
}
