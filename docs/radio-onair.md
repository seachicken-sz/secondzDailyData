# Radio on-air capture
GAS dispatches capture-radio-onair.yml on main; no cron. Configure RADIO_WEB_APP_URL and RADIO_SYNC_TOKEN secrets.
The GAS endpoint accepts POST JSON action/token: list returns items; upsertOnair accepts run_id, run_url, station_id, target_date, fetched_count, items; recordFetchLog accepts run_id, run_url, station_id, target_date, status, error_message.
Initial JFN collector is conservative and not live-tested. All stations must remain disabled until permission and date/pagination/DOM checks are completed. Other collectors are not implemented yet. No public redistribution. Existing scripts unchanged.
