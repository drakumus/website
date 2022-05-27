import React, {Component} from "react";
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts';

// const data = [{name: 'Page A', uv: 400, pv: 2400, amt: 2400}, ...];

class AttendenceComponent extends Component{
    state = {

    }

    componentDidMount() {
        this.getStaticmemberAttendance()
            .then(res => {
              this.setState({attendance: res})
              console.log(res)
            })
            .catch(err => console.log(err));
    }

    getStaticmemberAttendance = async() => {
        //const attendance_response = await fetch('https://zoci.me//attendance/static', {credentials: 'same-origin'});
        const attendance_response = await fetch('https://zoci.me/attendance/static', {credentials: 'same-origin'});
        const attendance = await attendance_response.json();
        console.log(attendance)
        if (attendance_response.status !== 200) {
          throw Error(attendance.message)
        }

        const users_response = await fetch('https://zoci.me/drops/static_members', {credentials: 'same-origin'});
        const users = await users_response.json()
        console.log(users)
        if (users_response.status != 200) {
            throw Error(users.message)
        }

        let users_by_id = {}
        for(let index in users)
        {
            let user = users[index]
            users_by_id[user.id] = user.display_name
        }

        let player_attendance_data = []
        for(let attendance_index in attendance)
        {
            let attendance_point = attendance[attendance_index]
            let data_point = {
                name: users_by_id[attendance_point.user_id],
                attendance_day: attendance_point.attendance_day,
                minutes_late: attendance_point.minutes_late
            }
            player_attendance_data.push(data_point)
        }

        return player_attendance_data
    }

    
    render() {
        let attendance_by_date = {}
        let names = {}
        // sort by date using hash table for ease of use
        for(const row_index in this.state.attendance)
        {
            let row = this.state.attendance[row_index]
            console.log(row)
            
            let date = row.attendance_day.split('T')[0].split('-').join('/')

            attendance_by_date[date] = {
                ...attendance_by_date[date],
                [row.name]: 
                {
                    minutes_late: row.minutes_late
                }
            }

            const num_days = Object.keys(attendance_by_date).length
            if(!(row.name in names))
            {
                names[row.name] = 
                {
                    attendance_percent: 1/num_days,
                    minutes_late: row.minutes_late
                }
            } else
            {
                names[row.name].attendance_percent = (names[row.name].attendance_percent/num_days) + (1/num_days)
                names[row.name].minutes_late += row.minutes_late
            }
            // add percent at this point after
            attendance_by_date[date][row.name].attendance_percent = names[row.name].attendance_percent

            console.log(names[row.name])
        }

        let date_data = []
        // create date attendance table data
        for(const date in attendance_by_date)
        {
            let tmp =
            {
                date: date
            }

            for(const name in attendance_by_date[date])
            {
                tmp[name] = attendance_by_date[date][name].attendance_percent
            }

            console.log(tmp)
            date_data.push(tmp)
        }

        // create lines
        let lines = []
        for(const name in names)
        {
            lines.push(<Line type="monotone" dataKey={name} stroke="#8884d8" />)
        }
        console.log(lines)

        return (
            <div className="container-fluid">
                <div className="row">
                    <div className="col-sm justify-content-center d-flex">
                        <div class="row justify-content-center p-2">
                            <LineChart width={800} height={400} data={date_data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                                {lines}
                                <CartesianGrid stroke="#ccc" strokeDasharray="5 5" />
                                <XAxis dataKey="date" />
                                <YAxis tickFormatter={tick => `${tick*100}%`}/>
                                <Tooltip />
                            </LineChart>
                        </div>
                    </div>
                </div>
            </div>
        )
    }
}

export default AttendenceComponent;