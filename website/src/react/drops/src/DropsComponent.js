import './drops_style.css';
import React, {Component} from "react";
import DropsTable from './DropsTable';
import LogItemModal from './LogItemModal';
import DropsList from './DropsList';


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

class DropsComponent extends Component {
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

  render() {
    return (
    <div>
      <LogItemModal static_members={this.state.static_members} main_drops={this.state.main_drops} alt_drops={this.state.alt_drops} updateDrops={this.updateDrops.bind(this)} item_types={item_types}>
      </LogItemModal>
      <div class="container-fluid">
        <div class="row">
          <div class="col-sm d-flex">
            <div class="row justify-content-center p-2">
              <div class="col-sm justify-content-end d-flex">
              <DropsTable static_members={this.state.static_members} main_drops={this.state.main_drops} alt_drops={this.state.alt_drops} bis={this.state.bis} item_types={item_types}>
                </DropsTable>
              </div>
              <div class="col-sm d-flex">
                <button type="button" id="addDropButton" class="btn btn-primary" data-bs-toggle="modal" data-bs-target="#addDropModal">+</button>
              </div>
              <div class="col-sm d-flex">
                <div class="col-sm d-flex">
                  <DropsList static_members={this.state.static_members} main_drops={this.state.main_drops} alt_drops={this.state.alt_drops} item_types={item_types}>
                  </DropsList>
                </div>
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
