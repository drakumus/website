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

function getPlayerNameFromID(player_id, players)
{
  for(let index in players)
  {
    if(player_id === players[index].id)
    {
      return players[index].player_name
    }
  }

  return "";
}

class DropsList extends Component {
  state = {
  }

  render() {
    let drop_rows = []
    for ( let drop_index in this.props.main_drops)
    {
      console.log(this.props.main_drops)
      let drop_row = (
      <tr>
        <td>{getPlayerNameFromID(this.props.main_drops[drop_index].player_id, this.props.static_members)}</td>
        <td>{item_types[this.props.main_drops[drop_index].item_type]}</td>
        <td>{this.props.main_drops[drop_index].date_received}</td>
      </tr>)
      drop_rows.push(drop_row)
    }

    // populate item rows with acquired or not and whether they're BiS

    let table = (
      <div className="App">
        <table class="styled-table">
          <thead>
            <tr id="table-head">
              <th>Player</th>
              <th>Drop</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {drop_rows}
          </tbody>
        </table>
      </div>
    );

    return table;
  }
}



export default DropsList;