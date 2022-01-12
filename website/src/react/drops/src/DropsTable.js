import logo from './logo.svg';
import './drops_style.css';
import React, {Component} from "react";

const item_types = [
  "Weapon",
  "Head",
  "Chest",
  "Gloves",
  "Legs",
  "Boots",
  "Earrings",
  "Necklace",
  "Bracelet",
  "Ring1",
  "Ring2"
]

function getPlayerItemReq(item_type, player_id, bis_data)
{
  let player_bis = {}
  for(let index in bis_data)
  {
    if(bis_data[index].player_id == player_id)
    {
      player_bis = bis_data[index]
    }
  }
  if(Object.keys(player_bis).length == 0)
  {
    console.log("Could not find player_id: " + player_id)
    return false;
  }

  let item_key_name = `uses_raid_${item_types[item_type].toLowerCase()}`
  return player_bis[item_key_name] != 0
}

class DropsTable extends Component {
  state = {
  }

  componentDidMount() {
    this.getStaticMembersDataAPI()
      .then(res => this.setState(res))
      .catch(err => console.log(err));
  }

  getStaticMembersDataAPI = async () => {
    const static_members_response = await fetch('/static_members');
    const static_members_body = await static_members_response.json();
    console.log(static_members_body)
    if (static_members_response.status !== 200) {
      throw Error(static_members_body.message)
    }

    const main_drops_response = await fetch('/main_drops');
    const main_drops_body = await main_drops_response.json();
    console.log(main_drops_body)
    if (main_drops_response.status !== 200) {
      throw Error(main_drops_body.message)
    }

    const alt_drops_response = await fetch('/alt_drops');
    const alt_drops_body = await alt_drops_response.json();
    console.log(alt_drops_body)
    if (alt_drops_response.status !== 200) {
      throw Error(alt_drops_body.message)
    }

    const bis_response = await fetch('/bis');
    const bis_body = await bis_response.json();
    console.log(bis_body)
    if (bis_response.status !== 200) {
      throw Error(bis_body.message)
    }

    return {
      static_members: static_members_body,
      main_drops: main_drops_body,
      alt_drops: alt_drops_body,
      bis: bis_body
    };
  };

  getMainDropsApi = async () => {
    const response = await fetch('/main_drops');
    const body = await response.json();
    if (response.status !== 200) {
      throw Error(body.message)
    }
    return body;
  };

  render() {
    // <td>❌</td>
    // <td>🟨</td>
    // <td>✔️</td>

    // populate names column
    let names = []
    for ( let name_index in this.state.static_members )
    {
      console.log("adding name")
      names.push((<th>{this.state.static_members[name_index].player_name}</th>))
    }

    // populate item rows with acquired or not and whether they're BiS
    let item_rows = []
    for ( let item_type_index in item_types )
    {
      let item_td = []
      if(Array.isArray(this.state.main_drops))
      {
        let item_drops = this.state.main_drops.filter((player_drop) => { return player_drop.item_type == item_type_index })
        console.log(item_drops)
        for( let name_index in this.state.static_members )
        {
          let player_drops = item_drops.filter( (player_drop) => { return player_drop.player_id == this.state.static_members[name_index].id } )
          if(player_drops.length > 0)
          {
            // item_td.push((<td>{player_drops.length}</td>));
            item_td.push((<td>✔️</td>));
          } else if(!getPlayerItemReq(item_type_index, this.state.static_members[name_index].id, this.state.bis))
          {
            item_td.push((<td>-</td>));
          } else if(player_drops.length == 0)
          {
            item_td.push((<td>❌</td>));
          }
        }

      }
      item_rows.push((
        <tr class={item_types[item_type_index] + "-tr"}>
          <td>{item_types[item_type_index]}</td>
          {item_td}
        </tr>
      ))
    }

    let table = (
      <div className="App">
        <table class="styled-table">
          <thead>
            <tr id="table-head">
              <th>Gear</th>
              {names}
            </tr>
          </thead>
          <tbody>
            {item_rows}
          </tbody>
        </table>
      </div>
    );

    return table;
  }
}



export default DropsTable;
