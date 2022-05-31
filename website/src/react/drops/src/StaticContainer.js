import React, {Component} from "react";

import DropsComponent from './DropsComponent';
import AttendenceComponent from "./AttendanceComponent";

class StaticContainer extends Component{
    state = {

    }

    render() {
        return (
            <div>
                <ul class="nav nav-tabs justify-content-center" id="myTab" role="tablist">
                    <li class="nav-item" role="presentation">
                        <button class="nav-link active" id="attendance-tab" data-bs-toggle="tab" data-bs-target="#attendance" type="button" role="tab" aria-controls="attendance" aria-selected="true">Attendance</button>
                    </li>
                    <li class="nav-item" role="presentation">
                        <button class="nav-link" id="drop-tab" data-bs-toggle="tab" data-bs-target="#drop" type="button" role="tab" aria-controls="drop" aria-selected="false">Drops</button>
                    </li>
                </ul>
                <div class="tab-content" id="myTabContent">
                    <div class="tab-pane fade show active" id="attendance" role="tabpanel" aria-labelledby="attendance-tab"><AttendenceComponent/></div>
                    <div class="tab-pane fade" id="drop" role="tabpanel" aria-labelledby="drop-tab"><DropsComponent/></div>
                </div>
            </div>
        )
    }
}

export default StaticContainer;