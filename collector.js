// ==UserScript==
// @name         Data Collector Script with Install Prompt
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Sends data to a collector and saves it if it's new, with installation prompt
// @author       Your Name
// @match        https://inplayip.tv/*
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';

    // Функция для отображения сообщения о необходимости установки скрипта
    function showInstallPrompt() {
        const message = "Этот скрипт требует установки. Нажмите 'OK' для продолжения.";
        if (confirm(message)) {
            console.log("Скрипт установлен.");
        } else {
            console.log("Установка скрипта отменена.");
            return false; // Отмена установки
        }
        return true; // Установка подтверждена
    }

    // Вызов функции установки при загрузке скрипта
    if (!showInstallPrompt()) {
        return; // Прекращаем выполнение, если установка отменена
    }

    // URL коллектора для отправки данных
    const collectorUrl = 'https://sportarena.win/collector/';

    // Получение данных из локального хранилища
    const scheduleTable = JSON.parse(localStorage.getItem('scheduleTable'));

    if (scheduleTable) {
        // Проверка на наличие ранее сохранённых данных
        const previousData = JSON.parse(localStorage.getItem('previousData')) || {};

        // Сравнение и отправка данных в коллектор
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
                        // Сохранение новых данных
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
