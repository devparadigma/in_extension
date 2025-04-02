// ==UserScript==
// @name         Data Collector Script
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Sends data to a collector and saves it if it's new
// @author       dev
// @match        https://inplayip.tv/*
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';

    const collectorUrl = 'https://sportarena.win/collector/';
    const scheduleTable = JSON.parse(localStorage.getItem('scheduleTable'));

    if (scheduleTable) {
        const previousData = JSON.parse(localStorage.getItem('previousData')) || {};

        if (JSON.stringify(scheduleTable) !== JSON.stringify(previousData)) {
            GM_xmlhttpRequest({
                method: "POST",
                url: collectorUrl,
                headers: {
                    'Content-Type': 'application/json'
                },
                data: JSON.stringify(scheduleTable),
                onload: function(response) {
                    if (response.status === 200) {
                        console.log("Data successfully sent to the collector.");
                        localStorage.setItem('previousData', JSON.stringify(scheduleTable));
                    } else {
                        console.error(`Error sending data: ${response.status}`);
                    }
                }
            });
        } else {
            console.log("No new data to send.");
        }
    } else {
        console.error("No schedule table found in local storage.");
    }
})();
