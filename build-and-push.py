#!/usr/bin/env python3
"""
Скрипт сборки и публикации Docker-контейнеров для модулей ai, backend, frontend.
Кроссплатформенный вариант (работает в Windows, Linux, macOS).
"""

import argparse
import os
import sys
import subprocess
from pathlib import Path


# Коды цветов для красивого вывода в терминале
class Colors:
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    RESET = '\033[0m'


def log_info(msg: str):
    print(f"{Colors.BLUE}[INFO]{Colors.RESET} {msg}")


def log_success(msg: str):
    print(f"{Colors.GREEN}[SUCCESS]{Colors.RESET} {msg}")


def log_warn(msg: str):
    print(f"{Colors.YELLOW}[WARN]{Colors.RESET} {msg}")


def log_error(msg: str):
    print(f"{Colors.RED}[ERROR]{Colors.RESET} {msg}")


def run_cmd(cmd: list[str], dry_run: bool = False):
    cmd_str = " ".join(cmd)
    if dry_run:
        print(f"{Colors.YELLOW}[DRY-RUN]{Colors.RESET} {cmd_str}")
        return True

    log_info(f"Выполнение: {cmd_str}")
    result = subprocess.run(cmd)
    if result.returncode != 0:
        log_error(f"Команда завершилась с ошибкой (код {result.returncode}): {cmd_str}")
        return False
    return True


def main():
    parser = argparse.ArgumentParser(
        description="Скрипт для автоматической сборки и пуша Docker-контейнеров проекта."
    )
    parser.add_argument(
        "-r", "--registry",
        default=os.getenv("DOCKER_REGISTRY", ""),
        help="Адрес или префикс Docker Registry (например: ghcr.io/username или cr.yandex/crp123)"
    )
    parser.add_argument(
        "-t", "--tag",
        default=os.getenv("IMAGE_TAG", "latest"),
        help="Тег образа (по умолчанию: latest)"
    )
    parser.add_argument(
        "-m", "--modules",
        nargs="+",
        default=["ai", "backend", "frontend"],
        help="Список модулей для сборки (по умолчанию: ai backend frontend)"
    )
    parser.add_argument(
        "--no-push",
        action="store_true",
        help="Собрать образы без отправки в реестр"
    )
    parser.add_argument(
        "--platform",
        default="",
        help="Целевые платформы для buildx (например: linux/amd64,linux/arm64)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Вывести команды без выполнения"
    )

    args = parser.parse_args()

    root_dir = Path(__file__).parent.resolve()
    os.chdir(root_dir)

    should_push = not args.no_push
    registry = args.registry.strip().rstrip('/')

    print(f"{Colors.CYAN}====================================================={Colors.RESET}")
    print(f"{Colors.CYAN}     Сборка и публикация Docker контейнеров         {Colors.RESET}")
    print(f"{Colors.CYAN}====================================================={Colors.RESET}")
    print(f"Реестр (Registry): {Colors.YELLOW}{registry or '<локальный Docker>'}{Colors.RESET}")
    print(f"Тег (Tag):         {Colors.YELLOW}{args.tag}{Colors.RESET}")
    print(f"Пуш в реестр:      {Colors.YELLOW}{should_push}{Colors.RESET}")
    print(f"Модули:            {Colors.YELLOW}{', '.join(args.modules)}{Colors.RESET}")
    if args.platform:
        print(f"Платформы:         {Colors.YELLOW}{args.platform}{Colors.RESET}")
    print(f"{Colors.CYAN}====================================================={Colors.RESET}\n")

    built_images = []

    for module in args.modules:
        module_path = root_dir / module
        dockerfile_path = module_path / "Dockerfile"

        if not module_path.is_dir():
            log_error(f"Директория модуля '{module}' не существует!")
            sys.exit(1)

        if not dockerfile_path.is_file():
            log_error(f"Dockerfile в директории '{module}' не найден!")
            sys.exit(1)

        image_name = f"{registry}/dds-{module}:{args.tag}" if registry else f"dds-{module}:{args.tag}"

        log_info(f"=== Начинаем сборку модуля: {module} ===")
        log_info(f"Имя образа: {image_name}")

        if args.platform:
            build_cmd = [
                "docker", "buildx", "build",
                "--platform", args.platform,
                "-t", image_name,
                str(module_path)
            ]
            if should_push and registry:
                build_cmd.append("--push")
            else:
                build_cmd.append("--load")
        else:
            build_cmd = ["docker", "build", "-t", image_name, str(module_path)]

        if not run_cmd(build_cmd, args.dry_run):
            sys.exit(1)

        log_success(f"Модуль '{module}' успешно собран!")

        if should_push and not args.platform:
            if not registry:
                log_warn(f"Реестр не указан. Пуш пропущен для {image_name} (образ сохранен локально).")
            else:
                push_cmd = ["docker", "push", image_name]
                if not run_cmd(push_cmd, args.dry_run):
                    sys.exit(1)
                log_success(f"Образ '{image_name}' успешно отправлен!")

        built_images.append(image_name)
        print()

    print(f"{Colors.CYAN}====================================================={Colors.RESET}")
    print(f"{Colors.GREEN}  Сборка всех модулей успешно завершена!             {Colors.RESET}")
    print(f"{Colors.CYAN}====================================================={Colors.RESET}")
    print("Собраны следующие образы:")
    for img in built_images:
        print(f" - {Colors.GREEN}{img}{Colors.RESET}")
    print(f"{Colors.CYAN}====================================================={Colors.RESET}")


if __name__ == "__main__":
    main()
