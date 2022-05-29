import axios from "axios";
import React, {Component} from "react";

class LogAttendanceModal extends Component {
  state = {
    adminKeyInput: "",
    shake_style: {}
  }

  componentDidUpdate() {
    if(this.props.static_members == undefined)
    {
      return
    }

    let tmp_state = {}
    
    for(const user_index in this.props.static_members)
    {
      let user = this.props.static_members[user_index]
      if(`attendance_checkbox_${user.display_name}` in this.state)
      {
        return
      }

      tmp_state[`attendance_checkbox_${user.display_name}`] = true
      tmp_state[`minutes_late_${user.display_name}`] = 0
    }

    this.setState(tmp_state)

    console.log("Value set")
    console.log(tmp_state)
  }

  handleLogAttendance = async (e) => {
    e.preventDefault()
    let body = {
      admin_key: this.state.adminKeyInput
    }

    let data = []
    for(const user_index in this.props.static_members)
    {
      let user = this.props.static_members[user_index]
      let is_attending = this.state[`attendance_checkbox_${user.display_name}`]
      let minutes_late = this.state[`minutes_late_${user.display_name}`]

      if(!is_attending)
      {
        continue
      }

      let datapoint = {
        name: user.display_name,
        minutes_late: minutes_late
      }
      data.push(datapoint)
    }

    body.data = data

    console.log(body)

    let response = await axios.post('https://zoci.me/attendance/log_attendance', body, {
      withCredentials: true
    }).catch(err => {
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
      this.props.updateAttendance();
    }
  }

  handleInputChanged = e => {
    const target = e.target;

    const id = target.id
    const value = target.type === 'checkbox' ? target.checked : target.value;

    if(id.includes("minutes_late"))
    {
      if(isNaN(value))
      {
        console.log(value)
        return
      }
    }

    this.setState({
      [id]: value
    });
  }

  render() {
    let lines = []
    for(const user_index in this.props.static_members)
    {
      let user = this.props.static_members[user_index]
      let line = (
        <div class="row justify-content-center">
          <div class="col-3 d-flex align-items-start justify-content-center">
            <label for={`attendance_checkbox_${user.display_name}`} class="col-form-label control-label">{user.display_name}</label>
          </div>
          <div class="col-4">
            <div class="input-group mb-3">
              <div class="input-group-text">
                <input id={`attendance_checkbox_${user.display_name}`} class="form-check-input mt-0" type="checkbox" value="" aria-label={`Is ${user.display_name} attending?`} onChange={this.handleInputChanged}  checked={this.state[`attendance_checkbox_${user.display_name}`]}/>
              </div>
              <input id={`minutes_late_${user.display_name}`} type="number" class="form-control" aria-label="Minutes late" onChange={this.handleInputChanged} value={this.state[`minutes_late_${user.display_name}`]}/>
            </div>
          </div>
        </div>
      )
      lines.push(line)
    }

    return (
      <div class= "modal fade" id="logAttendanceModal">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Log Attendance</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body">
              <form>
                {lines}
                <div class="row justify-content-center" style={this.state.shake_style}>
                  <div class="col-7">
                    <div class="input-group mb-3">
                      <span class="input-group-text" id="adminKeyInputText">Admin Key:</span>
                      <input type="text" class="form-control" id="adminKeyInput" aria-describedby="adminKeyInputText" onChange={this.handleInputChanged}/>
                    </div>
                  </div>
                </div>
                <div class="modal-footer">
                  <button onClick={this.handleLogAttendance} id="logAttendanceButton" type="button" class="btn btn-primary flex-grow-1">Log</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    )
  }
}


export default LogAttendanceModal