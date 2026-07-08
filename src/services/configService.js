class ConfigValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

const CONFIG_DEFINITIONS = {
  "max-retries": {
    parse(value) {
      return parseIntegerConfig("max-retries", value, { min: 0 });
    },
  },
  "backoff-base": {
    parse(value) {
      return parseIntegerConfig("backoff-base", value, { min: 1 });
    },
  },
};

function parseIntegerConfig(key, value, { min }) {
  const normalizedValue = String(value).trim();
  const parsedValue = Number(normalizedValue);

  if (!Number.isInteger(parsedValue) || parsedValue < min) {
    throw new ConfigValidationError(
      `${key} must be an integer greater than or equal to ${min}`
    );
  }

  return parsedValue;
}

function createConfigService({ configRepository }) {
  if (!configRepository) {
    throw new Error("configService requires a configRepository");
  }

  function validateKey(key) {
    if (!CONFIG_DEFINITIONS[key]) {
      throw new ConfigValidationError(`Unsupported config key: ${key}`);
    }
  }

  function set(key, value) {
    validateKey(key);
    const parsedValue = CONFIG_DEFINITIONS[key].parse(value);
    return configRepository.setConfig(key, String(parsedValue));
  }

  function getNumber(key) {
    validateKey(key);
    const value = configRepository.getConfig(key);
    return CONFIG_DEFINITIONS[key].parse(value);
  }

  return {
    set,
    getNumber,
  };
}

module.exports = {
  createConfigService,
  ConfigValidationError,
};
