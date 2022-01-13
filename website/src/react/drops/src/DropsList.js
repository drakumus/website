import './drops_style.css';
import React, {Component} from "react";

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
      let date=this.props.main_drops[drop_index].date_received.split('T')[0].split('-')
      let drop_row = (
      <tr>
        <td>{getPlayerNameFromID(this.props.main_drops[drop_index].player_id, this.props.static_members)}</td>
        <td>{this.props.item_types[this.props.main_drops[drop_index].item_type]}</td>
        <td>{`${parseInt(date[1],10)}/${parseInt(date[2],10)}/${parseInt(date[0],10)}`}</td>
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
