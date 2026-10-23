public enum FixtureMath {
    public static func twice(_ value: Int) -> Int {
        return value * 2
    }
    public static func sign(_ value: Int) -> Int {
        if value > 0 {
            return 1
        }
        if value < 0 {
            return -1
        }
        return 0
    }
}
