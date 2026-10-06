ALTER TABLE users
    ADD COLUMN is_admin TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS report_solutions (
    report_id INT NOT NULL,
    response_text TEXT NOT NULL,
    action_taken TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'In Progress',
    reference_file_path VARCHAR(255) DEFAULT NULL,
    reference_file_name VARCHAR(255) DEFAULT NULL,
    reference_mime_type VARCHAR(100) DEFAULT NULL,
    responded_by INT DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (report_id),
    KEY report_solutions_responded_by (responded_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
