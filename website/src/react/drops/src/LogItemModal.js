import React, {Component} from "react";
import axios from 'axios';
import './animations.css';

// TODO move this to a common const file.
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

function getPlayerID(player_name, players)
{
  for(let index in players)
  {
    if (player_name === players[index].player_name)
    {
      return players[index].id
    }
  }
  return null
}

function getItemTypeIndex(item_name)
{
  for(let index in item_types)
  {
    if (item_name === item_types[index])
    {
      return index
    }
  }
  return null
}

class LogItemModal extends Component {
  state = {
    player_name: "Zoci",
    item_type: "Weapon",
    with_static: true,
    is_main: true,
    admin_key: "",
    shake_style: {}
  }

  handleLogLoot = async (e) => {
    e.preventDefault()
    let body = {
      player_id: getPlayerID(this.state.player_name, this.props.static_members),
      item_type_index: getItemTypeIndex(this.state.item_type),
      with_static: this.state.with_static,
      is_main: this.state.is_main,
      admin_key: this.state.admin_key
    }
    /*
    const requestOptions = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }

    const response = await fetch('http://localhost:5000/log_drops', requestOptions).catch(err => {
      console.log(err)
    })
    */
    console.log(body)

    let response = await axios.post('http://zoci.me:5000/log_drops', body).catch(err => {
      console.error(err);
      return {status: 403}
    });
    console.log(response);
    if(response.status === 403)
    {
      console.log("invalid admin key")
      this.setState({shake_style: {animation: "shake 0.5s"}})
      setTimeout(()=> {
        this.setState({shake_style: {}})
      }, 500)
    } else
    {
      this.props.updateDrops();
    }
  }

  handleInputChanged = e => {
    const target = e.target;

    const name = target.name;
    const value = target.type === 'checkbox' ? target.checked : target.value;

    this.setState({
      [name]: value
    });
  }

  render() {
    // populate names
    let names = []
    for ( let name_index in this.props.static_members )
    {
      names.push((<option>{this.props.static_members[name_index].player_name}</option>))
    }

    let item_types_options = []
    for ( let item_index in item_types )
    {
      item_types_options.push((<option>{item_types[item_index]}</option>))
    }


    return (
      <div class="modal fade" id="addDropModal" tabindex="-1">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Add Drop</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body">
              <div class="row">
                <div class="col-sm">
                  <select class="form-select" name="player_name" aria-label="Default select example" value={this.state.player_name} onChange={this.handleInputChanged}>
                    {names}
                  </select>
                </div>
                <div class="col-sm">
                  <select class="form-select" name="item_type" aria-label="Default select example" value={this.state.item_type} onChange={this.handleInputChanged}>
                    {item_types_options}
                  </select>
                </div>
              </div>
              <div class="row pt-3">
                <div class="col-sm">
                  <div class="form-check">
                    <input class="form-check-input" name="with_static" type="checkbox" value="true" id="isStaticCheckBox" onChange={this.handleInputChanged} checked={this.state.with_static}/>
                    <label class="form-check-label" for="flexCheckDefault">
                      Received With Static
                    </label>
                  </div>
                </div>
                <div class="col-sm">
                  <div class="form-check">
                    <input class="form-check-input" name="is_main" type="checkbox" value="true" id="isMainCheckBox" onChange={this.handleInputChanged} checked={this.state.is_main}/>
                    <label class="form-check-label" for="flexCheckDefault">
                      Main Gear Set
                    </label>
                  </div>
                </div>
              </div>
              <div class="row pt-3">
                <div class="col-sm">
                  <div class="form-floating" id="adminKeyForm" style={this.state.shake_style}>
                    <input id="adminKeyInput" type="text" name="admin_key" class="form-control" onChange={this.handleInputChanged}></input>
                    <label class="form-label" for="adminKeyInput">Admin Key</label>
                  </div>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button onClick={this.handleLogLoot} id="logDropButton" type="button" class="btn btn-primary">Log Drop</button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}



export default LogItemModal;
