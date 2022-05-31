import React, {Component} from "react";
import { LineChart, Line, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts';
import LogAttendanceModal from "./LogAttendanceModal";
import './drops_style.css';

// const data = [{name: 'Page A', uv: 400, pv: 2400, amt: 2400}, ...];

class AttendenceComponent extends Component{
    state = {

    }

    componentDidMount() {
        this.getStaticmemberAttendance()
            .then(res => {
              this.setState(res)
              console.log(res)
            })
            .catch(err => console.log(err));
    }

    getStaticmemberAttendance = async() => {

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
        
        const active_static_response = await fetch('https://zoci.me/drops/active_static_members', {credentials: 'same-origin'})
        const active_static_members = await active_static_response.json()
        console.log(active_static_members)
        if (active_static_response.status != 200) {
            throw Error(users.message)
        }

        const attendance_response = await fetch('https://zoci.me/attendance/static', {credentials: 'same-origin'});
        const attendance = await attendance_response.json();
        console.log(attendance)
        if (attendance_response.status !== 200) {
          throw Error(attendance.message)
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

        return {
            static_members: users,
            attendance: player_attendance_data,
            static_members_by_id: users_by_id,
            active_static_members: active_static_members
        }
    }

    updateAttendance = async () => {
        this.getStaticmemberAttendance()
        .then(res => this.setState(res))
        .catch(err => console.log(err))
    }

    getAttendanceByDate() {
        let attendance_by_date = {}

        // sort by date using hash table for ease of use
        for(const row_index in this.state.attendance)
        {
            let row = this.state.attendance[row_index]
            
            // strip hours/min from date object from mysql db
            let date = new Date(new Date(Date.parse(row.attendance_day)).toDateString()).getTime()

            attendance_by_date[date] = {
                ...attendance_by_date[date],
                [row.name]: 
                {
                    minutes_late: row.minutes_late
                }
            }
        }

        console.log(attendance_by_date)

        return attendance_by_date
    }

    initNames() {
        let names = {}

        for(const index in this.state.active_static_members)
        {
            let active_static_member = this.state.active_static_members[index]

            names[active_static_member.display_name] = {
                start_date: new Date(new Date(Date.parse(active_static_member.start_date)).toDateString()).getTime(),
                num_days: 0,
                days_attended: 0,
                attendance_percent: 100,
                minutes_late: 0
            }
        }

        console.log(names)

        return names
    }

    getAttendancePercent(sorted_dates, attendance_by_date, names)
    {
        console.log(sorted_dates)
        for(const date_index in sorted_dates)
        {
            let date = sorted_dates[date_index]
            let day_attendance = attendance_by_date[date]
            for(const name in names)
            {
                if(day_attendance[name])
                {
                    console.log(`${name} found`)
                    names[name].num_days += 1
                    names[name].days_attended += 1
                    names[name].minutes_late += day_attendance[name].minutes_late
                } else if(date >= names[name].start_date)
                { 
                    console.log(`${name} not found, in attendance range`)
                    // Increment num days if the person didn't show up on a day's attendance
                    names[name].num_days += 1
                    // have to init the object since it didn't exist before
                    day_attendance[name] = {
                        minutes_late: 0
                    }

                } else // not past start date yet don't do anything
                {
                    console.log(`${name} not found and outside attendance range`)
                    continue
                }

                names[name].attendance_percent = ((names[name].days_attended / names[name].num_days) * 100).toFixed(2)
                day_attendance[name].attendance_percent = names[name].attendance_percent
            }
            console.log(day_attendance)
        }

        let result = {
            names: names,
            attendance_by_date: attendance_by_date
        }

        console.log(result)
        
        return result
    }
    
    render() {
        let attendance_by_date = this.getAttendanceByDate()
        let sorted_dates = Object.keys(attendance_by_date).sort((a,b) => parseInt(a)-parseInt(b))
        let names = this.initNames()

        let result = this.getAttendancePercent(sorted_dates, attendance_by_date, names)
        attendance_by_date = result.attendance_by_date
        names = result.names
        

        let date_data = []
        // create date attendance table data
        for(const date_index in sorted_dates)
        {
            let date = parseInt(sorted_dates[date_index])
            let date_obj = new Date(parseInt(date))
            let tmp =
            {
                date: `${date_obj.getMonth()+1}/${date_obj.getDate()}/${date_obj.getFullYear()}`
            }

            for(const name in attendance_by_date[date])
            {
                tmp[name] = attendance_by_date[date][name].attendance_percent
            }

            console.log(tmp)
            date_data.push(tmp)
        }

        // let line_colors = ["#fac89e", "#e3e891", "#c2fc99", "#a3fcb3", "#92e8d5", "#96c8f2", "#ada8ff", "#ce94f7", "#ed94dd", "#fea8bb"]

        // create lines
        let lines = []
        let idx = 0
        for(const name in names)
        {
            lines.push(<Line type="monotone" dataKey={name} stroke="#8884d8" />)
            idx += 1
        }
        console.log(lines)

        let bar_data = []
        for(const name in names)
        { 
            bar_data.push({
                name: name,
                attendance_percent: names[name].attendance_percent,
                minutes_late: names[name].minutes_late
            })
        }

        return (
            <div>
                <div className="position-absolute top-0 end-0 pt-1 mt-5 me-2">
                    <button type="button" id="logAttendanceButton" class="btn btn-primary" data-bs-toggle="modal" data-bs-target="#logAttendanceModal">
                        <div className="d-flex justify-content-center align-items-center">+</div>
                    </button>
                </div>
                <LogAttendanceModal static_members={this.state.active_static_members} updateAttendance={this.updateAttendance.bind(this)}>
                </LogAttendanceModal>
                <div className="container-fluid">
                    <div className="row">
                        <div className="col-sm">
                            <div class="row p-2">
                                <h1 class="text-center">By Day</h1>
                            </div>
                            <div class="row justify-content-center p-2">
                                <LineChart width={1000} height={400} data={date_data} margin={{ top: 5, right: 20, bottom: 50, left: 0 }}>
                                    {lines}
                                    <CartesianGrid stroke="#ccc" strokeDasharray="5 5" />
                                    <XAxis dataKey="date"/>
                                    <YAxis tickFormatter={tick => `${tick}%`}/>
                                    <Tooltip />
                                </LineChart>
                            </div>
                            <div class="row p-2">
                                <h1 class="text-center">Total</h1>
                            </div>
                            <div class="row justify-content-center p-2">
                                <BarChart width={1000} height={400} data={bar_data} margin={{ top: 5, right: 20, bottom: 50, left: 0 }}>
                                    {lines}
                                    <CartesianGrid stroke="#ccc" strokeDasharray="5 5" />
                                    <XAxis dataKey="name" offset="bottom"/>
                                    <YAxis tickFormatter={tick => `${tick}%`}/>
                                    <Tooltip />
                                    <Bar dataKey="attendance_percent" fill="#8884d8"/>
                                </BarChart>
                            </div>
                            <div class="row p-2">
                                <h1 class="text-center">Total Minutes Late</h1>
                            </div>
                            <div class="row justify-content-center p-2">
                                <BarChart width={1000} height={400} data={bar_data} margin={{ top: 5, right: 20, bottom: 15, left: 0 }}>
                                    {lines}
                                    <CartesianGrid stroke="#ccc" strokeDasharray="5 5" />
                                    <XAxis dataKey="name" />
                                    <YAxis/>
                                    <Tooltip />
                                    <Bar dataKey="minutes_late" fill="#8884d8"/>
                                </BarChart>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )
    }
}

export default AttendenceComponent;