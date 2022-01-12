import React from 'react';
import ReactDOM from 'react-dom';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import DropsTable from './DropsTable';
import LogItemModal from './LogItemModal';

ReactDOM.render(
  <React.StrictMode>
    <DropsTable/>
  </React.StrictMode>,
  document.getElementById('root')
);

ReactDOM.render(
  <React.StrictMode>
    <LogItemModal/>
  </React.StrictMode>,
  document.getElementById('logItemModal')
)

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
