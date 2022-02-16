import './drops_style.css';
import React, {Component} from "react";
import DropsTable from './DropsTable';
import LogItemModal from './LogItemModal';
import DropsList from './DropsList';


const item_types = [
  "Weapon",         // 0
  "Head",           // 1
  "Chest",          // 2
  "Gloves",         // 3
  "Legs",           // 4
  "Boots",          // 5
  "Earrings",       // 6
  "Necklace",       // 7
  "Bracelet",       // 8
  "Ring",           // 9
  "Lube",           // 10
  "Twine",          // 11
  "Ether",          // 12
  "Tomestone",      // 13
  "Roborant",       // 14
]

class DropsComponent extends Component {
  state = {
    is_main: true
  }

  componentDidMount() {
    this.getStaticMembersDataAPI()
      .then(res => this.setState(res))
      .catch(err => console.log(err));
  }

  getStaticMembersDataAPI = async () => {
    const static_members_response = await fetch('https://zoci.me/drops/static_members', {credentials: 'same-origin'});
    const static_members_body = await static_members_response.json();
    console.log(static_members_body)
    if (static_members_response.status !== 200) {
      throw Error(static_members_body.message)
    }

    const main_drops_response = await fetch('https://zoci.me/drops/main_drops', {credentials: 'same-origin'});
    const main_drops_body = await main_drops_response.json();
    console.log(main_drops_body)
    if (main_drops_response.status !== 200) {
      throw Error(main_drops_body.message)
    }

    const alt_drops_response = await fetch('https://zoci.me/drops/alt_drops', {credentials: 'same-origin'});
    const alt_drops_body = await alt_drops_response.json();
    console.log(alt_drops_body)
    if (alt_drops_response.status !== 200) {
      throw Error(alt_drops_body.message)
    }

    const bis_response = await fetch('https://zoci.me/drops/bis', {credentials: 'same-origin'});
    const bis_body = await bis_response.json();
    console.log("bis")
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

  updateDrops = async () => {
    this.getStaticMembersDataAPI()
    .then(res => this.setState(res))
    .catch(err => console.log(err))
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
    return (
    <div>
      <LogItemModal static_members={this.state.static_members} main_drops={this.state.main_drops} alt_drops={this.state.alt_drops} updateDrops={this.updateDrops.bind(this)} item_types={item_types}>
      </LogItemModal>
      <div class="container-fluid">
        <div class="row">
          <div class="col-sm justify-content-center d-flex">
            <div class="row justify-content-center p-2">
              <div class="col-sm justify-content-end d-flex">
              <DropsTable static_members={this.state.static_members} main_drops={this.state.main_drops} alt_drops={this.state.alt_drops} bis={this.state.bis} item_types={item_types} is_main={this.state.is_main}>
                </DropsTable>
              </div>
              <div class="col-sm">
                <div class="row p-2 justify-content-center">
                  <button type="button" id="addDropButton" class="btn btn-primary align-items-center p-0" data-bs-toggle="modal" data-bs-target="#addDropModal">
                    <h1 id="addDropButtonText m-0 p-0">
                      +
                    </h1>
                  </button>
                </div>
                <div class="row m-2">
                  <div class="form-check form-switch align-items-center justify-content-center d-flex m-0 p-0">
                    <input class="form-check-input m-0 p-0" name="is_main" type="checkbox" id="isMainCheckbox" onChange={this.handleInputChanged} checked={this.state.is_main}/>
                  </div>
                </div>
                <div class="row">
                  <h3>{this.state.is_main ? "Main": "Alts"}</h3>
                </div>
              </div>
              <div class="col-sm d-flex">
                <DropsList static_members={this.state.static_members} main_drops={this.state.main_drops} alt_drops={this.state.alt_drops} item_types={item_types} is_main={this.state.is_main}>
                </DropsList>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    )
  }
}



export default DropsComponent;
