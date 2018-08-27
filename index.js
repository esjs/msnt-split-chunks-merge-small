class MsntSplitChunksMergeSmall {
  constructor(options) {
    const defaults = {
      // Chunks lower this limit will be merged
      minSize: 10000 // 10kB
    };

    this.options = Object.assign(defaults, options);
  }

  apply(compiler) {
    compiler.hooks.thisCompilation.tap(
      'MsntSplitChunksMergeSmall',
      compilation => {
        compilation.hooks.afterOptimizeChunks.tap(
          'MsntSplitChunksMergeSmall',
          chunks => {
            this.mergeSmallChunks(chunks, compiler);
          }
        );
      }
    );
  }

  mergeSmallChunks(chunks, compiler) {
    const optimizationOptions = compiler.options.optimization;

    const commonChunks = [];
    const entryChunks = [];

    chunks.forEach(chunk => {
      if (chunk.chunkReason) {
        commonChunks.push(chunk);
      } else {
        entryChunks.push(chunk);
      }
    });

    // keep track of chunk ID's that are no longer available
    const removedChunkBlocks = [];

    // list of small chunk id's, that must be merged into entry chunk
    const smallMergedChunks = [];

    // holds refenreces map for merged chunks
    // require to add all required chunks on merge
    const removedChunksMap = new Map();

    const bigCommonChunks = [];

    let smallCommonChunks = commonChunks.filter(chunk => {
      const isSmall = this.getChunkSize(chunk) < this.options.minSize;

      if (!isSmall) {
        bigCommonChunks.push(chunk);
      }

      return isSmall;
    });

    // TODO: sort entry chunks by total small chunk size (or by small chunks count???)
    // this way we would get maximum value from merging

    // we need to loop through all required commonchunks of entry chunk
    // and merge those that are in smallCommmonChunks array
    entryChunks.forEach(entryChunk => {
      // an entry point for current entryChunk
      const entryPoint = Array.from(entryChunk.groupsIterable)[0];

      // store newly removed chunks, we will need them
      // to store references to merged chunk
      const newRemovedChunks = [];

      // remove/add chunks based on previous entryChunks operations
      for (const [oldChunk, newChunk] of removedChunksMap) {
        this.replaceOldWithNewOrRemove(entryPoint, oldChunk, newChunk);
      }

      if (!smallCommonChunks.length) return;

      // flag which indicates that we found our first match
      // and we don't need to remove this chunk, just merge all other chunks
      // into this one
      let isFirstMatch = true;

      const chunksToMerge = [];

      // with each iteration merge all small chunks required by entryChunk
      // and add all merged chunk ID's to removedChunkIds array
      // to remove them in on other entry points
      smallCommonChunks = smallCommonChunks.filter(chunk => {
        if (!entryPoint.chunks.includes(chunk)) return true;

        chunksToMerge.push(chunk);

        if (isFirstMatch) {
          isFirstMatch = false;
        } else {
          newRemovedChunks.push(chunk);
          entryPoint.removeChunk(chunk);
          chunk.removeGroup(entryPoint);
        }

        return false;
      });

      // if there are no required small chunks to merge, continue...
      if (!chunksToMerge.length) return;

      const mainChunk = this.mergeChunksIntoFirst(chunksToMerge);

      // store correct chunks mapping, to update indexes in other entryChunks
      newRemovedChunks.forEach(chunk => {
        removedChunksMap.set(chunk, mainChunk);
      });

      // if merged chunk is still not large enough
      if (this.getChunkSize(mainChunk) < this.options.minSize) {
        smallMergedChunks.push(mainChunk);
      } else {
        bigCommonChunks.push(mainChunk);
      }
    });

    // if after all merge operations there are still small chunks
    // merge all of them into one and update entry chunks to use it
    if (smallMergedChunks.length) {
      bigCommonChunks.push(
        this.mergeSmallMergedChunks(entryChunks, smallMergedChunks)
      );
    }

    return bigCommonChunks;
  }

  mergeChunksIntoFirst(chunks) {
    const mainChunk = chunks.shift();

    // unlink modules from old chunk, and link to target merge chunk
    chunks.forEach(chunk => {
      for (const mod of chunk.modulesIterable) {
        mod.removeChunk(chunk);

        mainChunk.addModule(mod);
        mod.addChunk(mainChunk);
      }
    });

    return mainChunk;
  }

  replaceOldWithNewOrRemove(entryPoint, oldChunk, newChunk) {
    const oldChunkIndex = entryPoint.chunks.indexOf(oldChunk);

    // if entry chunk doesn't have this removed chunk - skip
    if (oldChunkIndex === -1) return;

    // if new chunks is not in array of required chunks, replace first old one with it
    if (!entryPoint.chunks.includes(newChunk)) {
      entryPoint.chunks.splice(oldChunkIndex, 1, newChunk);

      // otherwise just remove old one
    } else {
      entryPoint.chunks.splice(oldChunkIndex, 1);
    }
  }

  // we need to remove all merged chunks except first one
  // in which we we will merge everything at the end
  mergeSmallMergedChunks(entryChunks, smallMergedChunks) {
    const removeChunks = smallMergedChunks.slice(),
      mainChunk = removeChunks.shift();

    entryChunks.forEach(entryChunk => {
      const entryPoint = Array.from(entryChunk.groupsIterable)[0];

      removeChunks.forEach(removeChunk => {
        this.replaceOldWithNewOrRemove(entryPoint, removeChunk, mainChunk);
      });
    });

    return this.mergeChunksIntoFirst(smallMergedChunks);
  }

  getChunkSize(chunk) {
    const size = chunk.getModules().reduce((totalSize, module) => {
      return totalSize + module.size();
    }, 0);

    return size;
  }
}

module.exports = MsntSplitChunksMergeSmall;
