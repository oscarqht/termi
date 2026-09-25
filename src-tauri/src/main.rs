fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--daemon" || a == "-d") {
        termi_lib::run_daemon();
    } else {
        termi_lib::run();
    }
}
