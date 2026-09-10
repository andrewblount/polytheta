import Foundation
import Security
// The paired Watch relays requests through the phone; it never receives this token.
enum TokenStore {
    private static var query: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.andrewblount.polytheta.api", kSecAttrAccount as String: "owner"] }
    static func load() -> String? {
        var q = query; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    @discardableResult static func save(_ value: String) -> Bool {
        if value.isEmpty { let status = SecItemDelete(query as CFDictionary); return status == errSecSuccess || status == errSecItemNotFound }
        let data = Data(value.utf8)
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecSuccess { return true }
        guard status == errSecItemNotFound else { return false }
        var q = query; q[kSecValueData as String] = data
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
    }
}
