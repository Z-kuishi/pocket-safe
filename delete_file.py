# delete_file.py
import sys
import os
import shutil
import time
import json

# 强制使用 UTF-8 输出
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def delete_path(path):
    """删除文件或文件夹"""
    if not os.path.exists(path):
        return True, "文件不存在"
    
    try:
        if os.path.isfile(path):
            os.remove(path)
            return True, "文件已删除"
        elif os.path.isdir(path):
            try:
                shutil.rmtree(path)
                return True, "文件夹已删除"
            except PermissionError:
                time.sleep(1)
                shutil.rmtree(path, ignore_errors=True)
                return True, "文件夹已强制删除"
    except Exception as e:
        return False, str(e)

def check_file_exists(path):
    """检查文件或文件夹是否存在"""
    return os.path.exists(path)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python delete_file.py <路径> [--check]")
        sys.exit(1)
    
    path = sys.argv[1]
    
    # 如果带 --check 参数，只检查是否存在
    if len(sys.argv) > 2 and sys.argv[2] == '--check':
        exists = check_file_exists(path)
        print(json.dumps({"exists": exists, "path": path}))
        sys.exit(0)
    
    # 否则执行删除
    success, message = delete_path(path)
    result = {"success": success, "message": message, "path": path}
    print(json.dumps(result))
    sys.exit(0 if success else 1)