package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
)

// encKey 是从 JWT_SECRET 派生的 AES-256 密钥，服务启动时初始化一次
var encKey []byte

// InitEncryption 从 JWT secret 派生 AES-256 加密密钥
func InitEncryption(jwtSecret string) {
	h := sha256.Sum256([]byte(jwtSecret))
	encKey = h[:32]
}

// Encrypt 使用 AES-256-GCM 加密明文，返回 base64 编码的 nonce+ciphertext
func Encrypt(plaintext string) (string, error) {
	if encKey == nil {
		return "", fmt.Errorf("加密未初始化")
	}
	block, err := aes.NewCipher(encKey)
	if err != nil {
		return "", err
	}
	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, aesGCM.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	ciphertext := aesGCM.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

// Decrypt 解密 AES-256-GCM 密文
func Decrypt(encoded string) (string, error) {
	if encKey == nil {
		return "", fmt.Errorf("加密未初始化")
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(encKey)
	if err != nil {
		return "", err
	}
	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonceSize := aesGCM.NonceSize()
	if len(data) < nonceSize {
		return "", fmt.Errorf("密文太短")
	}
	nonce, ciphertext := data[:nonceSize], data[nonceSize:]
	plaintext, err := aesGCM.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}
