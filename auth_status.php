<?php
header("Content-Type: application/json");
session_start();

if (isset($_SESSION["user_id"], $_SESSION["user_name"])) {
    echo json_encode([
        "status" => "success",
        "user" => [
            "id" => (int)$_SESSION["user_id"],
            "name" => $_SESSION["user_name"],
            "is_admin" => !empty($_SESSION["is_admin"])
        ]
    ]);
} else {
    echo json_encode(["status" => "success", "user" => null]);
}
?>
