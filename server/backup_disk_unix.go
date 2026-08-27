//go:build !windows

package main

import (
	"golang.org/x/sys/unix"
)

// diskFreeBytes 返回目录所在文件系统对非特权进程可用空间。
func diskFreeBytes(path string) (int64, error) {
	var stat unix.Statfs_t
	if err := unix.Statfs(path, &stat); err != nil {
		return 0, err
	}
	return int64(stat.Bavail) * int64(stat.Bsize), nil
}
