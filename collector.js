// ==UserScript==
// @name         Data Retrieval and Collector Script
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Retrieves data from API and sends to collector if changed
// @author       Your Name
// @match        https://inplayip.tv/*
// @grant        GM_xmlhttpRequest
// @connect      api.inplayip.tv
// @connect      sportarena.win
// ==/UserScript==

(function() {
    'use strict';

    // URL для получения таблицы
    const tableUrl = 'https://api.inplayip.tv/api/schedule/table';
    // URL коллектора для отправки данных
    const collectorUrl = 'https://sportarena.win/collector/';

    // Функция для получения текущей даты и времени в формате ISO 8601 (UTC)
    function getCurrentTime() {
        return new Date().toISOString();
    }

    // Функция для получения данных с API
    function fetchDataFromApi() {
        const accessToken = localStorage.getItem('accessToken');

        if (!accessToken) {
            console.error("Authorization token not found.");
            return Promise.reject("Authorization token not found.");
        }

        // Текущая дата и время в UTC
        const currentTime = getCurrentTime();
        // Данные для запроса таблицы
        const tableData = {
            filters: {
                searchDate: currentTime,
                searchWord: "",
                onlyNew: false,
                showVOD: false,
                showLive: false,
                sportsCriteria: [],
                countriesCriteria: [],
                servicesCriteria: []
            },
            timezoneOffset: 0
        };

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: tableUrl,
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                data: JSON.stringify(tableData),
                onload: function(response) {
                    if (response.status === 200) {
                        const tableResult = JSON.parse(response.responseText);
                        resolve(tableResult);
                    } else {
                        reject(`Error fetching table: ${response.status}`);
                    }
                },
                onerror: function(error) {
                    reject(`Request failed: ${error}`);
                }
            });
        });
    }

    // Функция для отправки данных в коллектор
    function sendDataToCollector(data) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: collectorUrl,
                headers: {
                    'Content-Type': 'application/json'
                },
                data: JSON.stringify(data),
                onload: function(response) {
                    if (response.status === 200) {
                        resolve();
                    } else {
                        reject(`Error sending data: ${response.status}`);
                    }
                },
                onerror: function(error) {
                    reject(`Request failed: ${error}`);
                }
            });
        });
    }

    // Основная функция
    async function main() {
        try {
            // Получаем данные с API
            const newData = await fetchDataFromApi();
            
            // Получаем предыдущие данные из хранилища
            const previousData = JSON.parse(localStorage.getItem('previousData')) || {};
            
            // Сравниваем данные
            if (JSON.stringify(newData) !== JSON.stringify(previousData)) {
                console.log("New data found, sending to collector...");
                
                // Отправляем данные в коллектор
                await sendDataToCollector(newData);
                
                // Сохраняем новые данные
                localStorage.setItem('previousData', JSON.stringify(newData));
                localStorage.setItem('scheduleTable', JSON.stringify(newData));
                
                console.log("Data successfully sent and saved.");
            } else {
                console.log("No new data to send.");
            }
        } catch (error) {
            console.error("Error in main process:", error);
        }
    }

    // Запускаем основной процесс
    main();
})();
