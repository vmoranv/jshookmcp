#!/bin/bash

# Build the Docker image using Docker instead of Podman
if command -v docker &> /dev/null; then
  echo "Building Docker image using Docker...";
  docker build --no-cache -t jshookmcp .;
  if [ $? -eq 0 ]; then
    echo "Docker image built successfully!";
    exit 0;
  else
    echo "Docker build failed. Falling back to Podman...";
  fi
fi

# Fallback to Podman if Docker is not available or build fails
if command -v podman &> /dev/null; then
  echo "Building Docker image using Podman...";
  podman build --no-cache -t jshookmcp .;
  if [ $? -eq 0 ]; then
    echo "Podman image built successfully!";
    exit 0;
  else
    echo "Podman build failed. Attempting to reset Podman storage...";
    sudo rm -rf ~/.local/share/containers/;
    podman build --no-cache -t jshookmcp .;
    if [ $? -eq 0 ]; then
      echo "Podman image built successfully after reset!";
      exit 0;
    else
      echo "Podman build failed. Please check your Podman configuration.";
      exit 1;
    fi
  fi
else
  echo "Neither Docker nor Podman is installed. Please install one of them.";
  exit 1;
fi