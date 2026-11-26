ALTER TABLE work_trip_offers ADD COLUMN schedule_from TEXT;
ALTER TABLE work_trip_offers ADD COLUMN schedule_to TEXT;

ALTER TABLE work_trip_offers ADD CONSTRAINT work_trip_offers_schedule_period
    CHECK ((schedule_from IS NULL AND schedule_to IS NULL)
        OR (schedule_from IS NOT NULL AND schedule_to IS NOT NULL AND schedule_from <= schedule_to
            AND contract_id IS NOT NULL AND self_requested = 1));

CREATE UNIQUE INDEX work_trip_offers_by_schedule
    ON work_trip_offers(company_id, employee_id, contract_id, schedule_from, schedule_to)
    WHERE schedule_from IS NOT NULL;
