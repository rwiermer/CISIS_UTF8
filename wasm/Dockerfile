FROM emscripten/emsdk:6.0.4

WORKDIR /src

COPY . .

RUN cmake --preset wasm \
    && cmake --build --preset wasm --parallel

CMD ["cmake", "--build", "--preset", "wasm", "--parallel"]
