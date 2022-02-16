import './drops_style.css';
import React, {Component} from "react";

function getPlayerItemReq(item_type, player_id, bis_data, item_types)
{
  let player_bis = {}
  for(let index in bis_data)
  {
    if(bis_data[index].player_id === player_id)
    {
      player_bis = bis_data[index]
    }
  }
  if(Object.keys(player_bis).length === 0)
  {
    console.log("Could not find player_id: " + player_id)
    return false;
  }
  if(item_type > 9)
  {
    return false;
  } else
  {
    let item_key_name = `uses_raid_${item_types[item_type].toLowerCase()}`
    return player_bis[item_key_name] != 0
  }
}

class DropsTable extends Component {
  state = {
  }

  render() {
    // <td>❌</td>
    // <td>🟨</td>
    // <td>✔️</td>

    // populate names column
    let names = []
    for ( let name_index in this.props.static_members )
    {
      console.log("adding name")
      names.push((<th>{this.props.static_members[name_index].player_name}</th>))
    }
    console.log(this.props.item_types)
    // populate item rows with acquired or not and whether they're BiS
    let item_rows = []
    for ( let item_type_index in this.props.item_types )
    {
      let item_td = []
      let drops = this.props.is_main ? this.props.main_drops : this.props.alt_drops
      if(Array.isArray(drops))
      {
        let item_drops = drops.filter((player_drop) => { return player_drop.item_type.toString() === item_type_index })
        for( let name_index in this.props.static_members )
        {
          let player_drops = item_drops.filter( (player_drop) => { return player_drop.player_id === this.props.static_members[name_index].id } )
          let is_required = getPlayerItemReq(item_type_index, this.props.static_members[name_index].id, this.props.bis, this.props.item_types)
          if(player_drops.length > 0)
          {
            if (item_type_index > 9 || !this.props.is_main) // dusting, twine, ether
            {
              item_td.push((<td class="styled-table-text">{player_drops.length}</td>))
            }
            else if(is_required)
            {
              item_td.push((<td>✔️</td>));
            } else
            {
              item_td.push((<td class="styled-table-text">🗸</td>));
            }
            // item_td.push((<td>{player_drops.length}</td>));
          } else if(!is_required || !this.props.is_main)
          {
            item_td.push((<td>-</td>));
          } else if(player_drops.length === 0)
          {
            item_td.push((<td>❌</td>));
          }
        }

      }
      item_rows.push((
        <tr class={this.props.item_types[item_type_index] + "-tr"}>
          <td>{this.props.item_types[item_type_index]}</td>
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
