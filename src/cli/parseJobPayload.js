class PayloadValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "PayloadValidationError";
  }
}


function parseJobPayload(payload) {

  if (!payload || !payload.trim()) {
    throw new PayloadValidationError(
      "Job payload is required"
    );
  }


  // First try real JSON
  try {

    return JSON.parse(payload);

  } catch (originalError) {


    // Try fixing Windows PowerShell stripped JSON
    try {

      const repaired =
        repairPowerShellPayload(payload);


      return JSON.parse(repaired);


    } catch {


      throw new PayloadValidationError(
        `Invalid JSON payload. Use valid JSON like '{"id":"job1","command":"echo hello"}'. ${originalError.message}`
      );

    }

  }

}




function repairPowerShellPayload(payload) {

  const trimmed = payload.trim();


  if (
    !trimmed.startsWith("{") ||
    !trimmed.endsWith("}")
  ) {

    return payload;

  }


  const content =
    trimmed.slice(1, -1);



  const result = {};


  let currentKey = "";
  let currentValue = "";

  let readingKey = true;


  const pairs = [];



  for (let i = 0; i < content.length; i++) {


    const char = content[i];


    if (char === ":" && readingKey) {

      readingKey = false;
      continue;

    }


    if (
      char === "," &&
      !readingKey &&
      content
        .slice(i + 1)
        .match(/^[a-zA-Z_]+:/)
    ) {


      pairs.push([
        currentKey.trim(),
        currentValue.trim()
      ]);


      currentKey = "";
      currentValue = "";
      readingKey = true;


      continue;

    }



    if (readingKey) {

      currentKey += char;

    } else {

      currentValue += char;

    }


  }



  if (currentKey) {

    pairs.push([
      currentKey.trim(),
      currentValue.trim()
    ]);

  }




  for (const [key,value] of pairs) {


    if (!key) continue;


    if (key === "max_retries") {

      result[key] = Number(value);

    }

    else {

      result[key] = value;

    }


  }



  return JSON.stringify(result);

}





function buildEnqueuePayload(args = [], options = {}) {


  // recommended Windows usage:
  // enqueue --id job1 --command "echo hello"

  if (options.id || options.command) {


    const payload = {
      id: options.id,
      command: options.command,
    };


    if (options.maxRetries !== undefined) {

      payload.max_retries =
        Number(options.maxRetries);

    }

    if (options.runAt !== undefined) {

      payload.run_at = options.runAt;

    }


    return payload;

  }



  const rawPayload =
    args.join(" ");


  return parseJobPayload(rawPayload);

}




module.exports = {
  parseJobPayload,
  buildEnqueuePayload,
  PayloadValidationError,
};


