ALTER TABLE users
    MODIFY COLUMN name VARCHAR(302) NOT NULL,
    ADD COLUMN first_name VARCHAR(100) NOT NULL DEFAULT '' AFTER name,
    ADD COLUMN second_name VARCHAR(100) NOT NULL DEFAULT '' AFTER first_name,
    ADD COLUMN last_name VARCHAR(100) NOT NULL DEFAULT '' AFTER second_name,
    ADD COLUMN phone_number VARCHAR(32) NOT NULL DEFAULT '' AFTER email,
    ADD COLUMN id_no VARCHAR(50) NULL AFTER phone_number,
    ADD UNIQUE KEY users_id_no_unique (id_no);
