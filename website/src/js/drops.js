const db = require(`./db`)

const table_head = document.body.querySelector('#table-head');
if (table_head) {
  let users = db.getUsers();
  for(user_index in users)
  {
    let node = document.createElement('th')
    node.innerHTML = users[user_index].player_name
  }
};
