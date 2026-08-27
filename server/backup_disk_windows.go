//go:build windows

package main

import (
	"golang.org/x/sys/windows"
)

// diskFreeBytes 返回目录所在卷的可用空间；本地开发 / CI 在 Windows 上运行。
func diskFreeBytes(path string) (int64, error) {
	ptr, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return 0, err
	}
	var freeBytes, totalBytes, totalFreeBytes uint64
	if err := windows.GetDiskFreeSpaceEx(ptr, &freeBytes, &totalBytes, &totalFreeBytes); err != nil {
		return 0, err
	}
	return int64(freeBytes), nil
}
