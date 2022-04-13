import './drops_style.css';
import React, {Component} from "react";

function getPlayerBis(player_id, bis_data)
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
  }

  return player_bis
}


function getPlayerItemReq(item_type, player_bis, item_types)
{
  if(item_type > 9)
  {
    return false;
  } else
  {
    let item_name = item_types[item_type].toLowerCase();
    if(item_type == 9)
    {
      item_name = "ring1"
    }
    let item_key_name = `uses_raid_${item_name}`
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
          let player_bis = getPlayerBis(this.props.static_members[name_index].id, this.props.bis)
          let is_required = getPlayerItemReq(item_type_index, player_bis, this.props.item_types)
          if(player_drops.length > 0 || item_type_index > 9)
          {
            if (item_type_index > 9 && this.props.is_main) // twine, ether, etc
            {
              // case where item isn't needed and no drops received in main drop table
              let item_key_name = `num_${this.props.item_types[item_type_index].toLowerCase()}_needed`
              let num_deficit = player_drops.length - player_bis[item_key_name] // note this is a negative normally
              if(player_drops.length == 0 && player_bis[item_key_name] == 0)
              {
                item_td.push((<td>-</td>))
              }
              else
              {
                item_td.push((<td class="styled-table-text">{num_deficit >= 0 ? '✔️': num_deficit}</td>))
              }
            }
            else if (item_type_index > 9 || !this.props.is_main) // alt drops table
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
